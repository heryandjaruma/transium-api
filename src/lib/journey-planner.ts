import { buildGraph, haversine, Edge, Graph, WALK_SPEED_MPS } from "@/lib/bus-graph";
import { astar, CostWeights } from "@/lib/astar";
import { loadRouteShapes, withLegGeometry } from "@/lib/route-geometry";
import { pathSignature, summarizePath } from "@/lib/path-cost";
import { summarizeSegments, stepsFromSegments, walkSegment } from "@/lib/journey-segments";
import type { JourneySegment, JourneyStep, JourneySummary, LatLng } from "@/lib/journey";

type Stop = { lat: number; lng: number; name: string };
type LngLat = [number, number];
type PathStep = { stopId: string; via: (Edge & { geometry: LngLat[] }) | null };
type RouteRow = { ref: string; name: string; direction: string; color: string };

// How many nearby stops to consider as candidate boarding/alighting points. This is
// only a safety cap for pathologically dense clusters (e.g. multi-bay interchanges) —
// MAX_WALK_RADIUS_METERS below is the real limiter. Keeping this low silently drops
// legitimate candidates ranked by beeline distance: a stop that's a one-seat ride away
// (or a short walk from the destination) can rank outside the top few nearest-by-air
// stops when a transfer hub's several bays are all closer in a straight line, which
// biases the search toward hubs over the stop that's actually cheapest to use.
const CANDIDATE_STOP_COUNT = 20;
// Only consider stops within this walking radius as candidates.
const MAX_WALK_RADIUS_METERS = 1500;
// Below this, walking the whole trip is considered even if a bus route exists.
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

/** Returns the nearest bus stops to a point. */
function nearestStops(point: LatLng, stops: Map<string, Stop>, count: number, radiusMeters: number) {
    const ranked = [...stops.entries()]
        .map(([id, stop]) => ({ id, stop, distanceMeters: haversine(point, stop) }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters);

    const withinRadius = ranked.filter((r) => r.distanceMeters <= radiusMeters).slice(0, count);
    return withinRadius.length ? withinRadius : ranked.slice(0, 1);
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
 * cost profile. Searches every (boarding, alighting) candidate stop pair near
 * origin/destination and keeps whichever minimizes the weighted cost (walk-to-stop +
 * transit + walk-from-stop, all priced the way the profile prices everything else) —
 * see path-cost.ts for what a profile optimises for. Falls back to a single direct walk
 * segment when that's short enough and no slower than the best transit option found.
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
    cache: Map<string, Promise<PlannedJourney | null>>
): Promise<ProfileResult> {
    const { graph, stops, stopWaitSeconds, routeShapes, routesById } = ctx;
    const originName = origin.name ?? "Origin";
    const destinationName = destination.name ?? "Destination";

    const originCandidates = nearestStops(origin, stops, CANDIDATE_STOP_COUNT, MAX_WALK_RADIUS_METERS);
    const destCandidates = nearestStops(destination, stops, CANDIDATE_STOP_COUNT, MAX_WALK_RADIUS_METERS);

    const directWalkMeters = haversine(origin, destination);
    const directWalkSeconds = directWalkMeters / WALK_SPEED_MPS;

    let best: { path: PathStep[]; totalSeconds: number; weightedCost: number } | null = null;

    for (const oc of originCandidates) {
        for (const dc of destCandidates) {
            if (oc.id === dc.id) continue;
            const path = astar(graph, stops, oc.id, dc.id, weights);
            if (!path) continue;

            const boardsAVehicle = path.some((step) => step.via?.kind === "ride");
            const initialWaitSeconds = boardsAVehicle ? (stopWaitSeconds.get(oc.id) ?? 0) : 0;
            const s = summarizePath(path, weights, initialWaitSeconds);

            const walkToStopSeconds = oc.distanceMeters / WALK_SPEED_MPS;
            const walkFromStopSeconds = dc.distanceMeters / WALK_SPEED_MPS;
            const totalSeconds = walkToStopSeconds + s.totalSeconds + walkFromStopSeconds;
            const weightedCost = weights.walkTimeWeight * (walkToStopSeconds + walkFromStopSeconds) + s.weightedCost;

            if (!best || weightedCost < best.weightedCost) {
                best = { path: path as PathStep[], totalSeconds, weightedCost };
            }
        }
    }

    const preferDirectWalk = !best || (directWalkMeters <= DIRECT_WALK_THRESHOLD_METERS && directWalkSeconds < best.totalSeconds);

    if (preferDirectWalk) {
        const walk = await walkSegment(env, { ...origin, name: originName }, { ...destination, name: destinationName });
        if (!walk) return null;
        const journey = { segments: [walk], summary: summarizeSegments([walk]), steps: stepsFromSegments([walk]) };
        // All direct-walk results for a given origin/destination are the same trip,
        // regardless of profile — give them a shared, constant signature.
        return { signature: "walk", journey };
    }

    const signature = pathSignature(best!.path);
    if (!cache.has(signature)) {
        cache.set(
            signature,
            (async () => {
                const pathWithGeometry = withLegGeometry(best!.path, stops, routeShapes) as PathStep[];

                const boardingStopId = pathWithGeometry[0].stopId;
                const alightingStopId = pathWithGeometry[pathWithGeometry.length - 1].stopId;
                const boardingStop = stops.get(boardingStopId)!;
                const alightingStop = stops.get(alightingStopId)!;

                const initialWalk = await walkSegment(
                    env,
                    { ...origin, name: originName },
                    { lat: boardingStop.lat, lng: boardingStop.lng, name: boardingStop.name, stopId: boardingStopId }
                );
                if (!initialWalk) return null;

                const transitLegs = buildTransitLegs(pathWithGeometry, stops, routesById);

                const finalWalk = await walkSegment(
                    env,
                    { lat: alightingStop.lat, lng: alightingStop.lng, name: alightingStop.name, stopId: alightingStopId },
                    { ...destination, name: destinationName }
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
