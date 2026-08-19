import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDirections } from "@/lib/apple-maps";
import { buildGraph, haversine, Edge, WALK_SPEED_MPS } from "@/lib/bus-graph";
import { astar, CostWeights } from "@/lib/astar";
import { loadRouteShapes, withLegGeometry } from "@/lib/route-geometry";
import { ROUTE_PROFILES, pathSignature, summarizePath } from "@/lib/path-cost";
import type { JourneyStep } from "@/lib/journey";

type LatLng = { lat: number; lng: number };
type LngLat = [number, number];
type Stop = { lat: number; lng: number; name: string };
type PathStep = { stopId: string; via: (Edge & { geometry: LngLat[] }) | null };

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

function parseLatLng(value: string | null): LatLng | null {
    if (!value) return null;
    const parts = value.split(",").map(Number);
    if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
    const [lat, lng] = parts;
    return { lat, lng };
}

/** Returns the nearest bus stops to a point. */
function nearestStops(point: LatLng, stops: Map<string, Stop>, count: number, radiusMeters: number) {
    const ranked = [...stops.entries()]
        .map(([id, stop]) => ({ id, stop, distanceMeters: haversine(point, stop) }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters);

    const withinRadius = ranked.filter((r) => r.distanceMeters <= radiusMeters).slice(0, count);
    return withinRadius.length ? withinRadius : ranked.slice(0, 1);
}

/** Gets a walking route from Apple Maps. */
async function walkSegment(
    env: CloudflareEnv,
    from: LatLng & { name: string; stopId?: string },
    to: LatLng & { name: string; stopId?: string }
) {
    const data = await getDirections(env, from, to, "Walking");
    const route = data.routes?.[0];
    if (!route) return null;

    const geometry: LngLat[] = [];
    const steps = (route.stepIndexes ?? []).map((i) => {
        const step = data.steps![i];
        const path = (data.stepPaths?.[step.stepPathIndex!] ?? []).map(
            (loc): LngLat => [loc.longitude, loc.latitude]
        );
        // Step paths share their boundary point with the next step's path, per Apple's docs.
        geometry.push(...(geometry.length ? path.slice(1) : path));
        return {
            instructions: step.instructions,
            distanceMeters: step.distanceMeters,
            durationSeconds: step.durationSeconds,
            geometry: path,
        };
    });

    return {
        type: "walk" as const,
        from,
        to,
        distanceMeters: route.distanceMeters ?? null,
        durationSeconds: route.durationSeconds ?? null,
        geometry,
        steps,
    };
}

/** Converts the A* path into bus and transfer segments. */
function buildTransitLegs(
    path: PathStep[],
    stops: Map<string, Stop>,
    routes: Map<string, { ref: string; name: string; direction: string; color: string }>
) {
    const legs: any[] = [];
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
            const route = routes.get(routeId);
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

/** Calculates the journey summary. */
function summarize(segments: any[]) {
    let walkingDistanceMeters = 0;
    let walkingDurationSeconds = 0;
    let transitDistanceMeters = 0;
    let busLegCount = 0;
    let transferCount = 0;

    for (const seg of segments) {
        if (seg.type === "walk") {
            walkingDistanceMeters += seg.distanceMeters ?? 0;
            walkingDurationSeconds += seg.durationSeconds ?? 0;
        } else if (seg.type === "bus") {
            transitDistanceMeters += seg.distanceMeters ?? 0;
            busLegCount++;
        } else if (seg.type === "transfer") {
            transitDistanceMeters += seg.distanceMeters ?? 0;
            transferCount++;
        }
    }

    return {
        distanceMeters: walkingDistanceMeters + transitDistanceMeters,
        walkingDistanceMeters,
        walkingDurationSeconds,
        transitDistanceMeters,
        busLegCount,
        transferCount,
    };
}

/**
 * Collapses journey segments into a brief outline — e.g. "Walk 5 min", "K5B", "Walk 3
 * min" — merging adjacent walk/transfer segments (both are walking to the rider) so a
 * boarding-stop transfer right after the initial walk doesn't show as two walk steps.
 */
function stepsFromSegments(segments: any[]): JourneyStep[] {
    const steps: JourneyStep[] = [];
    for (const seg of segments) {
        if (seg.type === "bus") {
            steps.push({
                type: "ride",
                routeRef: seg.routeRef ?? seg.routeId,
                routeName: seg.routeName,
                durationMinutes: Math.round((seg.durationSeconds ?? 0) / 60),
            });
            continue;
        }

        const durationMinutes = Math.round((seg.durationSeconds ?? 0) / 60);
        const last = steps[steps.length - 1];
        if (last?.type === "walk") {
            last.durationMinutes += durationMinutes;
        } else {
            steps.push({ type: "walk", durationMinutes });
        }
    }
    return steps;
}

/**
 * Finds a journey from origin to destination using walking and public transport.
 *
 * Query:
 * - `origin`: "lat,lng"
 * - `destination`: "lat,lng"
 *
 * Returns `{ alternativesAvailable, best, lessWalking?, lessTransit? }`. `best` is
 * always present — the lessWalking result, or the lessTransit one if lessWalking found
 * no route. `lessWalking`/`lessTransit` are only included when the two profiles land
 * on genuinely different journeys (`alternativesAvailable: true`); otherwise they're
 * omitted since `best` already represents both. See path-cost.ts for what the two
 * profiles optimise for. Each journey includes a brief `steps` outline (e.g. "Walk 5
 * min", "K5B", "Walk 3 min") alongside the full `segments`.
 */
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;

    const origin = parseLatLng(params.get("origin"));
    const destination = parseLatLng(params.get("destination"));

    if (!origin || !destination) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const { graph, stops, stopWaitSeconds } = await buildGraph(env.DB);

    if (stops.size === 0) {
        return NextResponse.json({ error: "No stops available" }, { status: 404 });
    }

    const originCandidates = nearestStops(origin, stops, CANDIDATE_STOP_COUNT, MAX_WALK_RADIUS_METERS);
    const destCandidates = nearestStops(destination, stops, CANDIDATE_STOP_COUNT, MAX_WALK_RADIUS_METERS);

    const directWalkMeters = haversine(origin, destination);
    const directWalkSeconds = directWalkMeters / WALK_SPEED_MPS;

    const routeShapes = await loadRouteShapes(env.DB);
    const routesRes = await env.DB.prepare(`SELECT id, ref, name, direction, color FROM BusRoute`).all();
    const routesById = new Map(
        (routesRes.results as any[]).map((r) => [r.id as string, r as { ref: string; name: string; direction: string; color: string }])
    );

    // Two profiles can land on the exact same physical path (common when only one
    // sensible route exists) — cache by the path's stop sequence so we don't hit Apple
    // Maps twice for identical walking legs, and so the outer comparison below can tell
    // the two profiles apart cheaply.
    type BuiltJourney = { segments: any[]; summary: ReturnType<typeof summarize>; steps: JourneyStep[] };
    const journeyCache = new Map<string, Promise<BuiltJourney | null>>();

    async function buildJourneyForProfile(weights: CostWeights): Promise<{ signature: string; journey: BuiltJourney } | null> {
        // Search every (boarding, alighting) candidate pair and keep whichever minimizes
        // the weighted cost (walk-to-stop + transit + walk-from-stop, all priced the same
        // way as the profile prices the rest of the trip). Ranking by distance instead
        // would systematically alight too early: an extra ride hop can only shorten the
        // remaining straight-line walk by at most its own length, so riding further never
        // pays off when a metre of bus costs the same as a metre on foot. The two walking
        // legs are straight-line estimates here — real walking geometry is only fetched
        // from Apple Maps for the winning pair, once each leg, below.
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
            const walk = await walkSegment(env, { ...origin!, name: "Origin" }, { ...destination!, name: "Destination" });
            if (!walk) return null;
            const journey = { segments: [walk], summary: summarize([walk]), steps: stepsFromSegments([walk]) };
            // All direct-walk results for a given origin/destination are the same trip,
            // regardless of profile — give them a shared, constant signature.
            return { signature: "walk", journey };
        }

        const signature = pathSignature(best!.path);
        if (!journeyCache.has(signature)) {
            journeyCache.set(
                signature,
                (async () => {
                    const pathWithGeometry = withLegGeometry(best!.path, stops, routeShapes) as PathStep[];

                    const boardingStopId = pathWithGeometry[0].stopId;
                    const alightingStopId = pathWithGeometry[pathWithGeometry.length - 1].stopId;
                    const boardingStop = stops.get(boardingStopId)!;
                    const alightingStop = stops.get(alightingStopId)!;

                    const initialWalk = await walkSegment(
                        env,
                        { ...origin!, name: "Origin" },
                        { lat: boardingStop.lat, lng: boardingStop.lng, name: boardingStop.name, stopId: boardingStopId }
                    );
                    if (!initialWalk) return null;

                    const transitLegs = buildTransitLegs(pathWithGeometry, stops, routesById);

                    const finalWalk = await walkSegment(
                        env,
                        { lat: alightingStop.lat, lng: alightingStop.lng, name: alightingStop.name, stopId: alightingStopId },
                        { ...destination!, name: "Destination" }
                    );
                    if (!finalWalk) return null;

                    const segments = [initialWalk, ...transitLegs, finalWalk];
                    return { segments, summary: summarize(segments), steps: stepsFromSegments(segments) };
                })()
            );
        }
        const journey = await journeyCache.get(signature)!;
        return journey ? { signature, journey } : null;
    }

    const [lessWalking, lessTransit] = await Promise.all([
        buildJourneyForProfile(ROUTE_PROFILES.lessWalking),
        buildJourneyForProfile(ROUTE_PROFILES.lessTransit),
    ]);

    if (!lessWalking && !lessTransit) {
        return NextResponse.json({ error: "No route found" }, { status: 404 });
    }

    const alternativesAvailable = !!lessWalking && !!lessTransit && lessWalking.signature !== lessTransit.signature;
    const toResponseJourney = (j: { journey: BuiltJourney }) => ({ origin, destination, ...j.journey });

    const results: Record<string, unknown> = {
        alternativesAvailable,
        best: toResponseJourney((lessWalking ?? lessTransit)!),
    };
    if (alternativesAvailable) {
        results.lessWalking = toResponseJourney(lessWalking!);
        results.lessTransit = toResponseJourney(lessTransit!);
    }

    return NextResponse.json(results);
}
