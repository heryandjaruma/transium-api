import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDirections } from "@/lib/apple-maps";
import { buildGraph, haversine, Edge, WALK_SPEED_MPS } from "@/lib/bus-graph";
import { astar } from "@/lib/astar";
import { loadRouteShapes, withLegGeometry } from "@/lib/route-geometry";

type LatLng = { lat: number; lng: number };
type LngLat = [number, number];
type Stop = { lat: number; lng: number; name: string };
type PathStep = { stopId: string; via: (Edge & { geometry: LngLat[] }) | null };

// How many nearby stops to consider as candidate boarding/alighting points.
const CANDIDATE_STOP_COUNT = 5;
// Only consider stops within this walking radius as candidates.
const MAX_WALK_RADIUS_METERS = 1500;
// Below this, walking the whole trip is considered even if a bus route exists.
const DIRECT_WALK_THRESHOLD_METERS = 1500;
// Wait for the first bus. Applied once per journey; later interchanges are already
// charged their own wait by the transfer edges in the graph.
const BOARDING_PENALTY_SECONDS = 300;

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
            while (j < path.length - 1 && path[j].via?.kind === "ride" && path[j].via?.routeId === routeId) {
                const segGeometry = path[j].via!.geometry;
                geometry.push(...(geometry.length ? segGeometry.slice(1) : segGeometry));
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
                stops: path.slice(startIdx, j + 1).map((step) => ({
                    stopId: step.stopId,
                    name: stops.get(step.stopId)!.name,
                })),
                distanceMeters,
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
 * Finds a journey from origin to destination using walking and public transport.
 *
 * Query:
 * - `origin`: "lat,lng"
 * - `destination`: "lat,lng"
 *
 * Returns journey segments for walking, bus rides, and transfers,
 * along with a summary of the trip.
 */
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;

    const origin = parseLatLng(params.get("origin"));
    const destination = parseLatLng(params.get("destination"));

    if (!origin || !destination) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const { graph, stops } = await buildGraph(env.DB);

    if (stops.size === 0) {
        return NextResponse.json({ error: "No stops available" }, { status: 404 });
    }

    const originCandidates = nearestStops(origin, stops, CANDIDATE_STOP_COUNT, MAX_WALK_RADIUS_METERS);
    const destCandidates = nearestStops(destination, stops, CANDIDATE_STOP_COUNT, MAX_WALK_RADIUS_METERS);

    // Search every (boarding, alighting) candidate pair and keep whichever minimizes
    // total estimated travel TIME (walk-to-stop + transit + walk-from-stop). Ranking by
    // distance instead would systematically alight too early: an extra ride hop can only
    // shorten the remaining straight-line walk by at most its own length, so riding
    // further never pays off when a metre of bus costs the same as a metre on foot.
    // Graph weights are already seconds; the two walking legs are straight-line estimates
    // here — real walking geometry is only fetched from Apple Maps for the winning pair,
    // once each leg, below.
    let best: { path: PathStep[]; seconds: number } | null = null;

    for (const oc of originCandidates) {
        for (const dc of destCandidates) {
            if (oc.id === dc.id) continue;
            const path = astar(graph, stops, oc.id, dc.id);
            if (!path) continue;
            const transitSeconds = path.reduce((sum, step) => sum + (step.via?.weight ?? 0), 0);
            const seconds =
                (oc.distanceMeters + dc.distanceMeters) / WALK_SPEED_MPS +
                transitSeconds +
                BOARDING_PENALTY_SECONDS;
            if (!best || seconds < best.seconds) {
                best = { path: path as PathStep[], seconds };
            }
        }
    }

    const directWalkMeters = haversine(origin, destination);
    const directWalkSeconds = directWalkMeters / WALK_SPEED_MPS;
    const preferDirectWalk = !best || (directWalkMeters <= DIRECT_WALK_THRESHOLD_METERS && directWalkSeconds < best.seconds);

    if (preferDirectWalk) {
        const walk = await walkSegment(
            env,
            { ...origin, name: "Origin" },
            { ...destination, name: "Destination" }
        );
        if (!walk) return NextResponse.json({ error: "No route found" }, { status: 404 });

        return NextResponse.json({
            origin,
            destination,
            summary: summarize([walk]),
            segments: [walk],
        });
    }

    const routeShapes = await loadRouteShapes(env.DB);
    const pathWithGeometry = withLegGeometry(best!.path, stops, routeShapes) as PathStep[];

    const boardingStopId = pathWithGeometry[0].stopId;
    const alightingStopId = pathWithGeometry[pathWithGeometry.length - 1].stopId;
    const boardingStop = stops.get(boardingStopId)!;
    const alightingStop = stops.get(alightingStopId)!;

    const initialWalk = await walkSegment(
        env,
        { ...origin, name: "Origin" },
        { lat: boardingStop.lat, lng: boardingStop.lng, name: boardingStop.name, stopId: boardingStopId }
    );
    if (!initialWalk) {
        return NextResponse.json({ error: "No walking route to boarding stop" }, { status: 404 });
    }

    const routesRes = await env.DB.prepare(`SELECT id, ref, name, direction, color FROM BusRoute`).all();
    const routesById = new Map(
        (routesRes.results as any[]).map((r) => [r.id as string, r as { ref: string; name: string; direction: string; color: string }])
    );

    const transitLegs = buildTransitLegs(pathWithGeometry, stops, routesById);

    const finalWalk = await walkSegment(
        env,
        { lat: alightingStop.lat, lng: alightingStop.lng, name: alightingStop.name, stopId: alightingStopId },
        { ...destination, name: "Destination" }
    );
    if (!finalWalk) {
        return NextResponse.json({ error: "No walking route from alighting stop" }, { status: 404 });
    }

    const segments = [initialWalk, ...transitLegs, finalWalk];

    return NextResponse.json({
        origin,
        destination,
        summary: summarize(segments),
        segments,
    });
}
