import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { walkSegment } from "@/lib/journey-segments";
import type { JourneyStep, JourneySummary, WalkSegment } from "@/lib/journey";

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

/** Sums walk segments into the same summary shape /api/journey/overview returns. */
function summarize(segments: WalkSegment[]): JourneySummary {
    const walkingDistanceMeters = segments.reduce((sum, seg) => sum + (seg.distanceMeters ?? 0), 0);
    const walkingDurationSeconds = segments.reduce((sum, seg) => sum + (seg.durationSeconds ?? 0), 0);
    return {
        distanceMeters: walkingDistanceMeters,
        walkingDistanceMeters,
        walkingDurationSeconds,
        transitDistanceMeters: 0,
        busLegCount: 0,
        transferCount: 0,
    };
}

/** A quest's walk is one continuous leg on foot, so its outline is a single "Walk N min" step. */
function stepsFromSegments(segments: WalkSegment[]): JourneyStep[] {
    if (segments.length === 0) return [];
    const durationMinutes = Math.round(segments.reduce((sum, seg) => sum + (seg.durationSeconds ?? 0), 0) / 60);
    return [{ type: "walk", durationMinutes }];
}

/**
 * Builds the real, walkable journey for a quest: the ordered checkpoints across its
 * badges' BadgeActions that carry a lat/lng, connected leg by leg with a real walking
 * route from Apple Maps. Unlike /api/journey/overview (which is asked to get between
 * two arbitrary points and may use transit), a quest's route is fixed by its own
 * waypoints and is walked in full, start to finish.
 *
 * Query:
 * - `questId`: the quest to build the route for
 *
 * Returns `{ questId, origin, destination, summary, segments, steps }`, or 400 if the
 * quest has fewer than two located waypoints to walk between.
 */
export async function GET(request: NextRequest) {
    const questId = request.nextUrl.searchParams.get("questId");
    if (!questId) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();

    const quest = await env.DB.prepare(`SELECT id FROM Quest WHERE id = ?`).bind(questId).first();
    if (!quest) return NextResponse.json({ error: "Quest not found" }, { status: 404 });

    const waypoints = await getQuestWaypoints(env.DB, questId);
    if (waypoints.length < 2) {
        return NextResponse.json({ error: "This quest doesn't have enough located steps to walk a route" }, { status: 400 });
    }

    const legs = await Promise.all(
        waypoints.slice(0, -1).map((from, i) => walkSegment(env, from, waypoints[i + 1]))
    );
    if (legs.some((leg) => !leg)) {
        return NextResponse.json({ error: "No route found" }, { status: 404 });
    }
    const segments = legs as WalkSegment[];

    return NextResponse.json({
        questId,
        origin: { lat: waypoints[0].lat, lng: waypoints[0].lng },
        destination: { lat: waypoints[waypoints.length - 1].lat, lng: waypoints[waypoints.length - 1].lng },
        summary: summarize(segments),
        segments,
        steps: stepsFromSegments(segments),
    });
}
