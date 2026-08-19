import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ROUTE_PROFILES } from "@/lib/path-cost";
import { buildJourneyForProfile, buildRoutingContext, PlannedJourney } from "@/lib/journey-planner";

type LatLng = { lat: number; lng: number };

function parseLatLng(value: string | null): LatLng | null {
    if (!value) return null;
    const parts = value.split(",").map(Number);
    if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
    const [lat, lng] = parts;
    return { lat, lng };
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
    const ctx = await buildRoutingContext(env.DB);

    if (ctx.stops.size === 0) {
        return NextResponse.json({ error: "No stops available" }, { status: 404 });
    }

    // Two profiles can land on the exact same physical path (common when only one
    // sensible route exists) — shared across both calls so we don't hit Apple Maps
    // twice for identical walking legs.
    const journeyCache = new Map<string, Promise<PlannedJourney | null>>();

    const [lessWalking, lessTransit] = await Promise.all([
        buildJourneyForProfile(env, ctx, origin, destination, ROUTE_PROFILES.lessWalking, journeyCache),
        buildJourneyForProfile(env, ctx, origin, destination, ROUTE_PROFILES.lessTransit, journeyCache),
    ]);

    if (!lessWalking && !lessTransit) {
        return NextResponse.json({ error: "No route found" }, { status: 404 });
    }

    const alternativesAvailable = !!lessWalking && !!lessTransit && lessWalking.signature !== lessTransit.signature;
    const toResponseJourney = (j: { journey: PlannedJourney }) => ({ origin, destination, ...j.journey });

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
