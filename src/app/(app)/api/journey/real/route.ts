import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";
import { ROUTE_PROFILES } from "@/lib/path-cost";
import { buildJourneyForProfile, buildRoutingContext, PlannedJourney, ProfileResult, RoutingContext } from "@/lib/journey-planner";
import { summarizeSegments, stepsFromSegments, walkSegment } from "@/lib/journey-segments";
import { haversine } from "@/lib/bus-graph";
import type { JourneySegment, MissionSegment } from "@/lib/journey";
import { parseMapsLang, MapsLang } from "@/lib/apple-maps";

type LatLng = { lat: number; lng: number };
type QuestBadgeRow = { badgeId: string };
type StepRow = {
    badgeId: string;
    sequence: number;
    lat: number | null;
    lng: number | null;
    instruction: string | null;
    actionName: string;
    badgeActionId: string;
};
type Waypoint = { lat: number; lng: number; name: string };
/** BadgeAction.id -> the caller's own JourneyAttemptStep.id generated from it (see getStepIdsByBadgeAction). */
type StepIdsByBadgeAction = Map<string, string>;

function parseLatLng(value: string | null): LatLng | null {
    if (!value) return null;
    const parts = value.split(",").map(Number);
    if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
    const [lat, lng] = parts;
    return { lat, lng };
}

/**
 * Returns every one of the quest's badge-attached steps, flattened in badge-attachment
 * then step-sequence order — same ordering as `getQuestOverviewSteps` in `POST
 * /private/journey/go`. Unlike a plain waypoint list, steps without coordinates (e.g. a
 * "read this" action) are kept: they still become a `mission` segment, they just don't
 * get a travel leg routed to them.
 */
async function getQuestSteps(db: D1Database, questId: string): Promise<StepRow[]> {
    const badgesRes = await db.prepare(`SELECT badgeId FROM QuestBadge WHERE questId = ?`).bind(questId).all<QuestBadgeRow>();
    const badgeIds = badgesRes.results.map((b) => b.badgeId);
    if (badgeIds.length === 0) return [];

    const placeholders = badgeIds.map(() => "?").join(", ");
    const stepsRes = await db
        .prepare(
            `SELECT ba.id as badgeActionId, ba.badgeId, ba.sequence, ba.lat, ba.lng, ba.instruction, ad.name as actionName
             FROM BadgeAction ba
             JOIN ActionDefinition ad ON ad.id = ba.actionId
             WHERE ba.badgeId IN (${placeholders})
             ORDER BY ba.sequence`
        )
        .bind(...badgeIds)
        .all<StepRow>();

    const stepsByBadge = new Map<string, StepRow[]>();
    for (const step of stepsRes.results) {
        if (!stepsByBadge.has(step.badgeId)) stepsByBadge.set(step.badgeId, []);
        stepsByBadge.get(step.badgeId)!.push(step);
    }

    return badgeIds.flatMap((badgeId) => stepsByBadge.get(badgeId) ?? []);
}

/**
 * Resolves the caller's own JourneyAttemptStep.id for each of this quest's BadgeActions,
 * keyed by BadgeAction.id, so mission segments/steps can be stamped with an exact
 * `stepId` instead of leaving the client to fuzzy-match by coordinates. Scoped to
 * `userId` and `questId` — a `journeyAttemptId` the caller doesn't own, or one that
 * belongs to a different quest, resolves to an empty map (no stepIds stamped) rather
 * than leaking another user's step ids.
 */
async function getStepIdsByBadgeAction(
    db: D1Database,
    journeyAttemptId: string,
    userId: string,
    questId: string
): Promise<StepIdsByBadgeAction> {
    const res = await db
        .prepare(
            `SELECT js.badgeActionId, js.id as stepId
             FROM JourneyStep js
             JOIN JourneyAttempt ja ON ja.id = js.journeyAttemptId
             JOIN UserQuest uq ON uq.id = ja.userQuestId
             WHERE js.journeyAttemptId = ? AND uq.userId = ? AND uq.questId = ? AND js.badgeActionId IS NOT NULL`
        )
        .bind(journeyAttemptId, userId, questId)
        .all<{ badgeActionId: string; stepId: string }>();
    return new Map(res.results.map((r) => [r.badgeActionId, r.stepId]));
}

function toWaypoint(step: StepRow & { lat: number; lng: number }): Waypoint {
    return { lat: step.lat, lng: step.lng, name: step.instruction ?? step.actionName };
}

function toMissionSegment(step: StepRow, stepIdsByBadgeAction: StepIdsByBadgeAction): MissionSegment {
    const stepId = stepIdsByBadgeAction.get(step.badgeActionId);
    return {
        type: "mission",
        instructions: step.instruction ?? step.actionName,
        ...(stepId != null ? { stepId } : {}),
        ...(step.lat != null && step.lng != null ? { lat: step.lat, lng: step.lng } : {}),
    };
}

/**
 * Interleaves one profile's travel legs — the origin→first-waypoint search result, plus
 * one quest leg per gap between consecutive located steps — with a `mission` segment for
 * every one of the quest's steps, located or not. An unlocated step contributes only its
 * mission segment, since there's nowhere to route a travel leg to.
 */
function buildFullJourney(
    originLeg: ProfileResult,
    questLegs: QuestLegProfileResult[],
    steps: StepRow[],
    stepIdsByBadgeAction: StepIdsByBadgeAction
): ProfileResult {
    if (!originLeg) return null;
    const segments: JourneySegment[] = [];
    let locatedCount = 0;
    for (const step of steps) {
        if (step.lat != null && step.lng != null) {
            const legSegments = locatedCount === 0 ? originLeg.journey.segments : questLegs[locatedCount - 1].segments;
            segments.push(...legSegments);
            locatedCount++;
        }
        segments.push(toMissionSegment(step, stepIdsByBadgeAction));
    }
    const journey: PlannedJourney = { segments, summary: summarizeSegments(segments), steps: stepsFromSegments(segments) };
    return { signature: originLeg.signature, journey };
}

// Between-mission legs stay a plain walk below this distance — a bus is only worth
// considering once the gap between two checkpoints starts looking like a real trip
// rather than a short walk across the same area.
const MIN_QUEST_LEG_TRANSIT_METERS = 1800;

type QuestLegProfileResult = { signature: string; segments: JourneySegment[] };
type QuestLegByProfile = { lessWalking: QuestLegProfileResult; lessTransit: QuestLegProfileResult };

/**
 * Builds one leg of the quest's own fixed route, between two consecutive waypoints.
 * Below MIN_QUEST_LEG_TRANSIT_METERS this is just a walk, same as before. Past that
 * distance it's routed the same way the origin→first-waypoint leg is — both cost
 * profiles searched for a walk/transit combination — so a bus gets offered between
 * missions too, not just on the way to the first one. Falls back to a plain walk if no
 * transit route is found at all, and only fails outright if even that walk fails.
 *
 * Each profile's result carries its `signature` (see `buildJourneyForProfile`) so the
 * caller can tell whether the two profiles actually diverged on this leg — not just on
 * the origin leg — when deciding whether to offer both as alternatives.
 */
async function buildQuestLeg(
    env: CloudflareEnv,
    ctx: RoutingContext,
    from: Waypoint,
    to: Waypoint,
    lang?: MapsLang
): Promise<QuestLegByProfile | null> {
    if (haversine(from, to) <= MIN_QUEST_LEG_TRANSIT_METERS) {
        const walk = await walkSegment(env, from, to, lang);
        if (!walk) return null;
        const leg = { signature: "walk", segments: [walk] };
        return { lessWalking: leg, lessTransit: leg };
    }

    const cache = new Map<string, Promise<PlannedJourney | null>>();
    const [lessWalking, lessTransit] = await Promise.all([
        buildJourneyForProfile(env, ctx, from, to, ROUTE_PROFILES.lessWalking, cache, lang),
        buildJourneyForProfile(env, ctx, from, to, ROUTE_PROFILES.lessTransit, cache, lang),
    ]);

    if (!lessWalking && !lessTransit) {
        const walk = await walkSegment(env, from, to, lang);
        if (!walk) return null;
        const leg = { signature: "walk", segments: [walk] };
        return { lessWalking: leg, lessTransit: leg };
    }
    const fallback = (lessWalking ?? lessTransit)!;
    const toLeg = (result: ProfileResult) => {
        const r = result ?? fallback;
        return { signature: r.signature, segments: r.journey.segments };
    };
    return { lessWalking: toLeg(lessWalking), lessTransit: toLeg(lessTransit) };
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
 * Each of the quest's own steps — located or not — also appears in `segments` as a
 * `{ type: "mission", instructions, stepId?, lat?, lng? }` entry, right after the travel
 * leg that reaches it (an unlocated step gets no travel leg, just its mission, since
 * there's nowhere to route it to). The glanceable `steps` outline carries the same
 * mission sign-posts at the same points, splitting any walk/ride entries around them.
 *
 * `stepId` — the matching JourneyAttemptStep.id from POST /private/journey/go — is only
 * stamped when the caller passes `journeyAttemptId` *and* authenticates as that attempt's
 * own owner; otherwise every mission's `stepId` is simply omitted. This lets a client
 * re-fetch its route from wherever it currently is (e.g. after GPS drift, or reopening
 * mid-journey) and join each mission back to its own local JourneyAttemptStep by id,
 * rather than guessing by nearest coordinate.
 *
 * Query:
 * - `origin`: caller's current position, as "lat,lng"
 * - `questId`: the quest to build the route for
 * - `journeyAttemptId` (optional): the caller's own in-progress JourneyAttempt for this
 *   quest — requires `Authorization: Bearer <session-token>` when passed, and is simply
 *   ignored (no `stepId`s stamped, no error) if it doesn't belong to the caller or to
 *   this quest
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
    const journeyAttemptId = params.get("journeyAttemptId");
    const lang = parseMapsLang(params.get("lang"));
    if (!origin || !questId) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();

    const quest = await env.DB.prepare(`SELECT id FROM Quest WHERE id = ?`).bind(questId).first();
    if (!quest) return NextResponse.json({ error: "Quest not found" }, { status: 404 });

    let stepIdsByBadgeAction: StepIdsByBadgeAction = new Map();
    if (journeyAttemptId) {
        const session = await getAuth().api.getSession({ headers: request.headers });
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        stepIdsByBadgeAction = await getStepIdsByBadgeAction(env.DB, journeyAttemptId, session.user.id, questId);
    }

    const steps = await getQuestSteps(env.DB, questId);
    const waypoints = steps
        .filter((step): step is StepRow & { lat: number; lng: number } => step.lat != null && step.lng != null)
        .map(toWaypoint);
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
        waypoints.slice(0, -1).map((from, i) => buildQuestLeg(env, ctx, from, waypoints[i + 1], lang))
    );
    if (questLegResults.some((leg) => !leg)) {
        return NextResponse.json({ error: "No route found" }, { status: 404 });
    }
    const questLegs = questLegResults as QuestLegByProfile[];

    const lessWalkingFull = buildFullJourney(lessWalking, questLegs.map((leg) => leg.lessWalking), steps, stepIdsByBadgeAction);
    const lessTransitFull = buildFullJourney(lessTransit, questLegs.map((leg) => leg.lessTransit), steps, stepIdsByBadgeAction);

    // Combine the origin leg's signature with every quest leg's signature so a
    // divergence between profiles on any leg — not just the origin leg — is what
    // decides whether the two profiles are offered as separate alternatives.
    const combinedSignature = (originLeg: ProfileResult, legs: QuestLegProfileResult[]) =>
        [originLeg?.signature ?? null, ...legs.map((leg) => leg.signature)].join("|");
    const lessWalkingSignature = combinedSignature(lessWalking, questLegs.map((leg) => leg.lessWalking));
    const lessTransitSignature = combinedSignature(lessTransit, questLegs.map((leg) => leg.lessTransit));
    const alternativesAvailable = !!lessWalkingFull && !!lessTransitFull && lessWalkingSignature !== lessTransitSignature;
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
