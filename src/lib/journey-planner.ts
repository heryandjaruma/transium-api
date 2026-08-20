import { buildGraph, haversine, Edge, Graph, WALK_SPEED_MPS } from "@/lib/bus-graph";
import { astar, CostWeights } from "@/lib/astar";
import { loadRouteShapes, withLegGeometry } from "@/lib/route-geometry";
import { pathSignature } from "@/lib/path-cost";
import { summarizeSegments, stepsFromSegments, walkSegment } from "@/lib/journey-segments";
import type { JourneySegment, JourneyStep, JourneySummary, LatLng } from "@/lib/journey";
import type { MapsLang } from "@/lib/apple-maps";

type Stop = { lat: number; lng: number; name: string };
type LngLat = [number, number];
type PathStep = { stopId: string; via: (Edge & { geometry: LngLat[] }) | null };
type RouteRow = { ref: string; name: string; direction: string; color: string };

// Only offer a stop as a boarding/alighting point within this walking radius. This is
// the only candidate filter now — see withVirtualEndpoints below for why there's no
// separate top-N-by-beeline-distance cap: capping by count instead of just radius is
// what let a closer, better stop get excluded from consideration entirely whenever a
// cluster (e.g. a multi-bay interchange) put more than N stops nearer-by-air.
const MAX_WALK_RADIUS_METERS = 1500;
// Only offer a direct walk end-to-end (no transit at all) below this distance — even
// if, past this distance, a straight-line walk happens to price out cheaper than every
// transit option found, a multi-kilometer walk isn't a plan worth surfacing.
const DIRECT_WALK_THRESHOLD_METERS = 1500;

export type RoutingContext = {
    graph: Graph;
    stops: Map<string, Stop>;
    stopWaitSeconds: Map<string, number>;
    routeShapes: Awaited<ReturnType<typeof loadRouteShapes>>;
    routesById: Map<string, RouteRow>;
};

/** Builds the shared, request-scoped state (bus graph, route shapes/metadata) every journey search needs. */
export async function buildRoutingContext(db: D1Database): Promise<RoutingContext> {
    const { graph, stops, stopWaitSeconds } = await buildGraph(db);
    const routeShapes = await loadRouteShapes(db);
    const routesRes = await db.prepare(`SELECT id, ref, name, direction, color FROM BusRoute`).all();
    const routesById = new Map((routesRes.results as any[]).map((r) => [r.id as string, r as RouteRow]));
    return { graph, stops, stopWaitSeconds, routeShapes, routesById };
}

const VIRTUAL_ORIGIN_ID = "__origin__";
const VIRTUAL_DESTINATION_ID = "__destination__";

/**
 * Grafts two request-scoped virtual nodes onto a copy of the base graph: `__origin__`,
 * with a walking edge to every real stop within MAX_WALK_RADIUS_METERS of `origin`
 * (plus a direct edge straight to `__destination__`, when that's short enough — see
 * DIRECT_WALK_THRESHOLD_METERS), and `__destination__`, reachable by a walking edge
 * from every real stop within radius of `destination`.
 *
 * This is what lets a single `astar` call stand in for what used to be an all-pairs
 * search over a hand-picked candidate list: because "walk to the destination from
 * here" is now a real edge available at *every* stop the search reaches — not just a
 * handful pre-selected by beeline distance — `astar`'s own cost minimisation is what
 * decides the boarding/alighting point, the same way it already decides every other
 * hop in the trip. Both are priced exactly like a transfer (walking time +, for the
 * origin side, the expected wait for a vehicle at the stop landed on) but flagged
 * `isAccess: true` so astar.ts's edgeCost exempts them from `transferPenalty` —
 * boarding/alighting isn't a mid-trip change of vehicle.
 *
 * The base graph and stop map are never mutated — `graph` is a shallow copy (edge
 * arrays are only ever replaced, never pushed onto, for the handful of stops gaining
 * an egress edge) so the same `ctx` can be reused across sibling calls (e.g. both cost
 * profiles for one request) safely.
 */
function withVirtualEndpoints(
    baseGraph: Graph,
    stops: Map<string, Stop>,
    stopWaitSeconds: Map<string, number>,
    origin: LatLng,
    destination: LatLng
): { graph: Graph; stops: Map<string, Stop> } {
    const graph: Graph = new Map(baseGraph);
    const stopsWithVirtual = new Map(stops);
    stopsWithVirtual.set(VIRTUAL_ORIGIN_ID, { ...origin, name: "Origin" });
    stopsWithVirtual.set(VIRTUAL_DESTINATION_ID, { ...destination, name: "Destination" });

    const originEdges: Edge[] = [];
    for (const [id, stop] of stops) {
        const originDist = haversine(origin, stop);
        if (originDist <= MAX_WALK_RADIUS_METERS) {
            const walkingTime = originDist / WALK_SPEED_MPS;
            const waitingTime = stopWaitSeconds.get(id) ?? 0;
            originEdges.push({
                to: id, kind: "transfer", isAccess: true, distanceMeters: originDist,
                inVehicleTime: 0, walkingTime, waitingTime, weight: walkingTime + waitingTime,
            });
        }

        const destDist = haversine(destination, stop);
        if (destDist <= MAX_WALK_RADIUS_METERS) {
            const walkingTime = destDist / WALK_SPEED_MPS;
            const egressEdge: Edge = {
                to: VIRTUAL_DESTINATION_ID, kind: "transfer", isAccess: true, distanceMeters: destDist,
                inVehicleTime: 0, walkingTime, waitingTime: 0, weight: walkingTime,
            };
            graph.set(id, [...(graph.get(id) ?? []), egressEdge]);
        }
    }

    const directDist = haversine(origin, destination);
    if (directDist <= DIRECT_WALK_THRESHOLD_METERS) {
        const walkingTime = directDist / WALK_SPEED_MPS;
        originEdges.push({
            to: VIRTUAL_DESTINATION_ID, kind: "transfer", isAccess: true, distanceMeters: directDist,
            inVehicleTime: 0, walkingTime, waitingTime: 0, weight: walkingTime,
        });
    }
    graph.set(VIRTUAL_ORIGIN_ID, originEdges);
    graph.set(VIRTUAL_DESTINATION_ID, []);

    return { graph, stops: stopsWithVirtual };
}

/** Converts the A* path into bus and transfer segments. */
function buildTransitLegs(path: PathStep[], stops: Map<string, Stop>, routesById: Map<string, RouteRow>): JourneySegment[] {
    const legs: JourneySegment[] = [];
    let i = 0;

    while (i < path.length - 1) {
        const via = path[i].via!;

        if (via.kind === "ride") {
            const routeId = via.routeId!;
            const startIdx = i;
            const geometry: LngLat[] = [];
            let j = i;
            let durationSeconds = 0;
            while (j < path.length - 1 && path[j].via?.kind === "ride" && path[j].via?.routeId === routeId) {
                const segGeometry = path[j].via!.geometry;
                geometry.push(...(geometry.length ? segGeometry.slice(1) : segGeometry));
                durationSeconds += path[j].via!.inVehicleTime;
                j++;
            }

            const boardStopId = path[startIdx].stopId;
            const alightStopId = path[j].stopId;
            const board = stops.get(boardStopId)!;
            const alight = stops.get(alightStopId)!;
            const route = routesById.get(routeId);
            const distanceMeters = path
                .slice(startIdx, j)
                .reduce((sum, step) => sum + (step.via?.distanceMeters ?? 0), 0);

            legs.push({
                type: "bus",
                routeId,
                routeRef: route?.ref ?? null,
                routeName: route?.name ?? null,
                routeColor: route?.color ?? null,
                from: { stopId: boardStopId, name: board.name, lat: board.lat, lng: board.lng },
                to: { stopId: alightStopId, name: alight.name, lat: alight.lat, lng: alight.lng },
                stops: path.slice(startIdx, j + 1).map((step) => {
                    const stop = stops.get(step.stopId)!;
                    return { stopId: step.stopId, name: stop.name, lat: stop.lat, lng: stop.lng };
                }),
                distanceMeters,
                durationSeconds,
                geometry,
            });
            i = j;
        } else {
            const fromStopId = path[i].stopId;
            const toStopId = via.to;
            const from = stops.get(fromStopId)!;
            const to = stops.get(toStopId)!;

            legs.push({
                type: "transfer",
                from: { stopId: fromStopId, name: from.name, lat: from.lat, lng: from.lng },
                to: { stopId: toStopId, name: to.name, lat: to.lat, lng: to.lng },
                distanceMeters: via.distanceMeters,
                durationSeconds: via.walkingTime,
                geometry: via.geometry,
            });
            i++;
        }
    }

    return legs;
}

export type PlannedJourney = { segments: JourneySegment[]; summary: JourneySummary; steps: JourneyStep[] };
export type ProfileResult = { signature: string; journey: PlannedJourney } | null;

/**
 * Plans a single door-to-door journey (walking + transit) between two points under one
 * cost profile. Runs one `astar` search from a virtual origin to a virtual destination
 * node — see `withVirtualEndpoints` — so the boarding/alighting point is whatever the
 * search itself finds cheapest under this profile's weights (path-cost.ts), rather than
 * being pre-narrowed to a hand-picked candidate list. The result degenerates into a
 * single direct walk segment automatically whenever that's what the search picked.
 *
 * `cache` dedupes by the winning path's stop sequence so two profiles that land on the
 * physically same route don't hit Apple Maps twice for identical walking legs — pass
 * the same cache across sibling calls (e.g. both profiles for one origin/destination)
 * to get that sharing; pass a fresh one otherwise.
 */
export async function buildJourneyForProfile(
    env: CloudflareEnv,
    ctx: RoutingContext,
    origin: LatLng & { name?: string },
    destination: LatLng & { name?: string },
    weights: CostWeights,
    cache: Map<string, Promise<PlannedJourney | null>>,
    lang?: MapsLang
): Promise<ProfileResult> {
    const { graph, stops, stopWaitSeconds, routeShapes, routesById } = ctx;
    const originName = origin.name ?? "Origin";
    const destinationName = destination.name ?? "Destination";

    const { graph: searchGraph, stops: searchStops } = withVirtualEndpoints(graph, stops, stopWaitSeconds, origin, destination);
    const rawPath = astar(searchGraph, searchStops, VIRTUAL_ORIGIN_ID, VIRTUAL_DESTINATION_ID, weights);
    if (!rawPath) return null;

    // Drop the two virtual endpoints. What's left, if anything, is the real transit
    // path between the stop the search chose to board at and the one it chose to
    // alight at. astar stores each entry's *outgoing* edge (path[i].via.to ===
    // path[i+1].stopId), so it's the last real stop whose `via` needs resetting to
    // null — it currently still points at the access-out edge into the virtual
    // destination, which withLegGeometry below can't resolve (that id isn't in the
    // real `stops` map it's given).
    const realStops = rawPath.slice(1, -1);
    const isDirectWalk = realStops.length === 0;

    if (isDirectWalk) {
        const walk = await walkSegment(env, { ...origin, name: originName }, { ...destination, name: destinationName }, lang);
        if (!walk) return null;
        const journey = { segments: [walk], summary: summarizeSegments([walk]), steps: stepsFromSegments([walk]) };
        // All direct-walk results for a given origin/destination are the same trip,
        // regardless of profile — give them a shared, constant signature.
        return { signature: "walk", journey };
    }
    const path = [
        ...realStops.slice(0, -1),
        { stopId: realStops[realStops.length - 1].stopId, via: null },
    ] as PathStep[];

    const signature = pathSignature(path);
    if (!cache.has(signature)) {
        cache.set(
            signature,
            (async () => {
                const pathWithGeometry = withLegGeometry(path, stops, routeShapes) as PathStep[];

                const boardingStopId = pathWithGeometry[0].stopId;
                const alightingStopId = pathWithGeometry[pathWithGeometry.length - 1].stopId;
                const boardingStop = stops.get(boardingStopId)!;
                const alightingStop = stops.get(alightingStopId)!;

                const initialWalk = await walkSegment(
                    env,
                    { ...origin, name: originName },
                    { lat: boardingStop.lat, lng: boardingStop.lng, name: boardingStop.name, stopId: boardingStopId },
                    lang
                );
                if (!initialWalk) return null;

                const transitLegs = buildTransitLegs(pathWithGeometry, stops, routesById);

                const finalWalk = await walkSegment(
                    env,
                    { lat: alightingStop.lat, lng: alightingStop.lng, name: alightingStop.name, stopId: alightingStopId },
                    { ...destination, name: destinationName },
                    lang
                );
                if (!finalWalk) return null;

                const segments = [initialWalk, ...transitLegs, finalWalk];
                return { segments, summary: summarizeSegments(segments), steps: stepsFromSegments(segments) };
            })()
        );
    }
    const journey = await cache.get(signature)!;
    return journey ? { signature, journey } : null;
}
