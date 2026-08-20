import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ROUTE_PROFILES } from "@/lib/path-cost";
import { buildJourneyForProfile, buildRoutingContext, PlannedJourney, ProfileResult } from "@/lib/journey-planner";
import { summarizeSegments, stepsFromSegments, walkSegment } from "@/lib/journey-segments";
import type { WalkSegment } from "@/lib/journey";
import { parseMapsLang } from "@/lib/apple-maps";

type LatLng = { lat: number; lng: number };
type QuestBadgeRow = { badgeId: string };
type WaypointRow = {
    badgeId: string;
    sequence: number;
    lat: number | null;
    lng: number | null;
    instruction: string | null;
    actionName: string;
};
type Waypoint = { lat: number; lng: number; name: string };

function parseLatLng(value: string | null): LatLng | null {
    if (!value) return null;
    const parts = value.split(",").map(Number);
    if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
    const [lat, lng] = parts;
    return { lat, lng };
}

/**
 * Returns the quest's badge-attached waypoints that carry a lat/lng, flattened in
 * badge-attachment then step-sequence order — same ordering as
 * `getQuestOverviewSteps` in `POST /private/journey/go`. Steps without coordinates
 * (e.g. a "read this" action) don't correspond to a place, so they're dropped here
 * rather than producing a zero-length walk leg.
 */
async function getQuestWaypoints(db: D1Database, questId: string): Promise<Waypoint[]> {
    const badgesRes = await db.prepare(`SELECT badgeId FROM QuestBadge WHERE questId = ?`).bind(questId).all<QuestBadgeRow>();
    const badgeIds = badgesRes.results.map((b) => b.badgeId);
    if (badgeIds.length === 0) return [];

    const placeholders = badgeIds.map(() => "?").join(", ");
    const stepsRes = await db
        .prepare(
            `SELECT ba.badgeId, ba.sequence, ba.lat, ba.lng, ba.instruction, ad.name as actionName
             FROM BadgeAction ba
             JOIN ActionDefinition ad ON ad.id = ba.actionId
             WHERE ba.badgeId IN (${placeholders})
             ORDER BY ba.sequence`
        )
        .bind(...badgeIds)
        .all<WaypointRow>();

    const stepsByBadge = new Map<string, WaypointRow[]>();
    for (const step of stepsRes.results) {
        if (!stepsByBadge.has(step.badgeId)) stepsByBadge.set(step.badgeId, []);
        stepsByBadge.get(step.badgeId)!.push(step);
    }

    return badgeIds
        .flatMap((badgeId) => stepsByBadge.get(badgeId) ?? [])
        .filter((step): step is WaypointRow & { lat: number; lng: number } => step.lat != null && step.lng != null)
        .map((step) => ({ lat: step.lat, lng: step.lng, name: step.instruction ?? step.actionName }));
}

/** Appends the quest's own fixed walking legs onto a profile's origin→first-waypoint result. */
function appendQuestLegs(result: ProfileResult, questLegs: WalkSegment[]): ProfileResult {
    if (!result) return null;
    if (questLegs.length === 0) return result;
    const segments = [...result.journey.segments, ...questLegs];
    const journey: PlannedJourney = { segments, summary: summarizeSegments(segments), steps: stepsFromSegments(segments) };
    return { signature: result.signature, journey };
}

/**
 * Builds the real, walkable journey for a quest, starting from wherever the caller
 * actually is. The leg from `origin` to the quest's first located waypoint is routed
 * the same way /api/journey/overview routes any door-to-door trip (walking and/or
 * transit, under both cost profiles) since the caller could be anywhere; every leg
 * after that is the quest's own fixed route — its ordered checkpoints across all
 * attached badges' BadgeActions that carry a lat/lng, connected with real walking
 * routes from Apple Maps, all the way to the quest's last checkpoint.
 *
 * Query:
 * - `origin`: caller's current position, as "lat,lng"
 * - `questId`: the quest to build the route for
 * - `lang` (optional): "id-ID" (default) or "en-US" — language for walking step instructions
 *
 * Returns the same envelope /api/journey/overview does — `{ questId,
 * alternativesAvailable, best, lessWalking?, lessTransit? }` — except `destination` on
 * each journey is always the quest's last checkpoint, not something the caller passed
 * in.
 */
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;

    const origin = parseLatLng(params.get("origin"));
    const questId = params.get("questId");
    const lang = parseMapsLang(params.get("lang"));
    if (!origin || !questId) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();

    const quest = await env.DB.prepare(`SELECT id FROM Quest WHERE id = ?`).bind(questId).first();
    if (!quest) return NextResponse.json({ error: "Quest not found" }, { status: 404 });

    const waypoints = await getQuestWaypoints(env.DB, questId);
    if (waypoints.length === 0) {
        return NextResponse.json({ error: "This quest has no located steps to route to" }, { status: 400 });
    }

    const ctx = await buildRoutingContext(env.DB);
    const firstWaypoint = { lat: waypoints[0].lat, lng: waypoints[0].lng, name: waypoints[0].name };

    const journeyCache = new Map<string, Promise<PlannedJourney | null>>();
    const [lessWalking, lessTransit] = await Promise.all([
        buildJourneyForProfile(env, ctx, origin, firstWaypoint, ROUTE_PROFILES.lessWalking, journeyCache, lang),
        buildJourneyForProfile(env, ctx, origin, firstWaypoint, ROUTE_PROFILES.lessTransit, journeyCache, lang),
    ]);

    if (!lessWalking && !lessTransit) {
        return NextResponse.json({ error: "No route found" }, { status: 404 });
    }

    const questLegResults = await Promise.all(
        waypoints.slice(0, -1).map((from, i) => walkSegment(env, from, waypoints[i + 1], lang))
    );
    if (questLegResults.some((leg) => !leg)) {
        return NextResponse.json({ error: "No route found" }, { status: 404 });
    }
    const questLegs = questLegResults as WalkSegment[];

    const lessWalkingFull = appendQuestLegs(lessWalking, questLegs);
    const lessTransitFull = appendQuestLegs(lessTransit, questLegs);

    const alternativesAvailable = !!lessWalkingFull && !!lessTransitFull && lessWalkingFull.signature !== lessTransitFull.signature;
    const destination = { lat: waypoints[waypoints.length - 1].lat, lng: waypoints[waypoints.length - 1].lng };
    const toResponseJourney = (j: { journey: PlannedJourney }) => ({ origin, destination, ...j.journey });

    const results: Record<string, unknown> = {
        questId,
        alternativesAvailable,
        best: toResponseJourney((lessWalkingFull ?? lessTransitFull)!),
    };
    if (alternativesAvailable) {
        results.lessWalking = toResponseJourney(lessWalkingFull!);
        results.lessTransit = toResponseJourney(lessTransitFull!);
    }

    return NextResponse.json(results);
}
