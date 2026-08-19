import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";
import { haversine } from "@/lib/bus-graph";

// A real, badge-authored waypoint: the location was picked on purpose, so the phone's
// geofence can stay tight. An artificial photo checkpoint is only ever snapped to the
// nearest such waypoint, not an exact spot, so it gets a looser radius.
const REQUIRED_STEP_RADIUS_METERS = 150;
const ARTIFICIAL_PHOTO_RADIUS_METERS = 300;

// Don't offer a photo checkpoint less than this far (by walked distance, not step count)
// from the previous one, or from a real step that's already a "take picture" action —
// spammy back-to-back prompts aren't worth the extra proof.
const MIN_PHOTO_CHECKPOINT_SPACING_METERS = 600;
const MAX_ARTIFICIAL_PHOTOS = 3;

type QuestBadgeRow = { badgeId: string };
type OverviewStepRow = {
    badgeId: string;
    sequence: number;
    lat: number | null;
    lng: number | null;
    instruction: string | null;
    actionName: string;
    actionDescription: string;
    type: string;
};
type JourneyAttemptRow = {
    id: string;
    userQuestId: string;
    currentStepSequence: number;
    status: string;
    createdAt: string;
    startedAt: string | null;
    endedAt: string | null;
};
type JourneyStepRow = {
    id: string;
    journeyAttemptId: string;
    sequence: number;
    name: string;
    description: string;
    type: string;
    lat: number | null;
    lng: number | null;
    radiusMeters: number | null;
    status: string;
};
type StepBlueprint = Pick<JourneyStepRow, "name" | "description" | "type" | "lat" | "lng" | "radiusMeters">;

function isPictureAction(name: string) {
    return /photo|picture/i.test(name);
}

/**
 * Interleaves 1-3 artificial "takePicture" checkpoints into the quest's overview steps,
 * so the user is prompted to document their journey even when none of the quest's own
 * actions do. Checkpoints are always snapped onto an existing waypoint's coordinates
 * (never an interpolated point that might not be walkable), spaced by actual walked
 * distance rather than step count, and skipped near any waypoint that's already a real
 * "take picture" action (name-matched — ActionDefinition has no dedicated kind field).
 *
 * The first checkpoint always lands on the route's very first located waypoint, i.e.
 * before the quest's own first action; up to two more are added, roughly evenly spaced,
 * the longer the route's total walked distance is.
 */
function withArtificialPhotoCheckpoints(overviewSteps: OverviewStepRow[]): StepBlueprint[] {
    const real: StepBlueprint[] = overviewSteps.map((step) => ({
        name: step.actionName,
        description: step.instruction ?? step.actionDescription,
        type: step.type,
        lat: step.lat,
        lng: step.lng,
        radiusMeters: step.lat != null && step.lng != null ? REQUIRED_STEP_RADIUS_METERS : null,
    }));

    // Cumulative walked distance across the route's located waypoints, in overview order.
    const geoPoints: { realIndex: number; cumDist: number; isPicture: boolean }[] = [];
    let cumDist = 0;
    let prev: { lat: number; lng: number } | null = null;
    real.forEach((step, realIndex) => {
        if (step.lat == null || step.lng == null) return;
        const point = { lat: step.lat, lng: step.lng };
        if (prev) cumDist += haversine(prev, point);
        prev = point;
        geoPoints.push({ realIndex, cumDist, isPicture: isPictureAction(step.name) });
    });
    if (geoPoints.length === 0) return real;

    const totalDist = geoPoints[geoPoints.length - 1].cumDist;
    const desiredCount = Math.min(
        MAX_ARTIFICIAL_PHOTOS,
        geoPoints.length,
        Math.max(1, Math.floor(totalDist / MIN_PHOTO_CHECKPOINT_SPACING_METERS) + 1)
    );

    // Pick `desiredCount` evenly spaced target distances (always including the very
    // start), snapping each to its nearest located waypoint.
    const chosenRealIndices = new Set<number>();
    for (let n = 0; n < desiredCount; n++) {
        const targetDist = (n / desiredCount) * totalDist;
        const nearest = geoPoints.reduce((best, gp) => (Math.abs(gp.cumDist - targetDist) < Math.abs(best.cumDist - targetDist) ? gp : best));
        chosenRealIndices.add(nearest.realIndex);
    }

    const pictureCumDists = geoPoints.filter((gp) => gp.isPicture).map((gp) => gp.cumDist);
    const anchors = [...chosenRealIndices]
        .filter((realIndex) => {
            const gp = geoPoints.find((g) => g.realIndex === realIndex)!;
            if (gp.isPicture) return false;
            return pictureCumDists.every((d) => Math.abs(d - gp.cumDist) >= MIN_PHOTO_CHECKPOINT_SPACING_METERS);
        })
        .sort((a, b) => a - b);

    if (anchors.length === 0) return real;

    const withPhotos: StepBlueprint[] = [];
    let nextAnchor = 0;
    real.forEach((step, realIndex) => {
        if (anchors[nextAnchor] === realIndex) {
            withPhotos.push({
                name: "takePicture",
                description: "Snap a photo of your journey here.",
                type: "optional",
                lat: step.lat,
                lng: step.lng,
                radiusMeters: ARTIFICIAL_PHOTO_RADIUS_METERS,
            });
            nextAnchor++;
        }
        withPhotos.push(step);
    });
    return withPhotos;
}

/**
 * Returns the quest's badge-attached steps (BadgeAction joined with ActionDefinition),
 * flattened in badge-attachment then step-sequence order — the same "overview" GET
 * /quest/{id} groups by badge. `type` ("required"/"optional") comes from BadgeAction
 * itself, not ActionDefinition — the same action can be required in one badge's flow and
 * optional in another's.
 */
async function getQuestOverviewSteps(db: D1Database, questId: string): Promise<OverviewStepRow[]> {
    const badgesRes = await db.prepare(`SELECT badgeId FROM QuestBadge WHERE questId = ?`).bind(questId).all<QuestBadgeRow>();
    const badgeIds = badgesRes.results.map((b) => b.badgeId);
    if (badgeIds.length === 0) return [];

    const placeholders = badgeIds.map(() => "?").join(", ");
    const stepsRes = await db
        .prepare(
            `SELECT ba.badgeId, ba.sequence, ba.lat, ba.lng, ba.instruction, ba.type,
                    ad.name as actionName, ad.description as actionDescription
             FROM BadgeAction ba
             JOIN ActionDefinition ad ON ad.id = ba.actionId
             WHERE ba.badgeId IN (${placeholders})
             ORDER BY ba.sequence`
        )
        .bind(...badgeIds)
        .all<OverviewStepRow>();

    const stepsByBadge = new Map<string, OverviewStepRow[]>();
    for (const step of stepsRes.results) {
        if (!stepsByBadge.has(step.badgeId)) stepsByBadge.set(step.badgeId, []);
        stepsByBadge.get(step.badgeId)!.push(step);
    }

    return badgeIds.flatMap((badgeId) => stepsByBadge.get(badgeId) ?? []);
}

/**
 * Starts a journey attempt for a quest. Body: `{ questId }`. Requires authentication.
 *
 * Finds or creates the caller's UserQuest for `questId`, then creates a JourneyAttempt
 * (`status: "started"`, `currentStepSequence: 0`) and a JourneyStep per BadgeAction in
 * the quest's overview (across all attached badges, in attachment/sequence order), each
 * carrying its action's name/description, its BadgeAction's own `type`
 * (`"required"`/`"optional"`), and lat/lng when the BadgeAction has one, initialised as
 * `status: "waiting"`. 1-3 artificial `type: "optional"` steps (`name: "takePicture"`) are
 * interleaved in — see `withArtificialPhotoCheckpoints` — so the user is prompted to
 * document their journey even when none of the quest's own actions do.
 *
 * `geofences` is the subset of `steps` that has a location — everywhere the phone should
 * register a `CLCircularRegion`, each with the `radiusMeters` the server itself checks
 * against in POST .../advance, so the client's region radius and the server's acceptance
 * distance never disagree.
 *
 * Fails with 409 if the caller already has a JourneyAttempt with `status: "started"` for
 * *any* quest — only one journey can be in progress at a time — including
 * `activeJourneyAttemptId` in the response so the client can route straight to it.
 */
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const { questId } = (body ?? {}) as Record<string, unknown>;

    if (typeof questId !== "string" || !questId.trim()) {
        return NextResponse.json({ error: "Invalid questId" }, { status: 400 });
    }

    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.user.id;

    const { env } = getCloudflareContext();

    const quest = await env.DB.prepare(`SELECT id FROM Quest WHERE id = ?`).bind(questId).first();
    if (!quest) return NextResponse.json({ error: "Quest not found" }, { status: 404 });

    const overviewSteps = await getQuestOverviewSteps(env.DB, questId);
    if (overviewSteps.length === 0) {
        return NextResponse.json({ error: "This quest has no steps to complete" }, { status: 400 });
    }

    // A user can only have one journey going at a time, across every quest — not just
    // this one — so they don't end up mid-walk on two different routes at once.
    const activeAttempt = await env.DB
        .prepare(
            `SELECT ja.id, uq.questId, q.name as questName
             FROM JourneyAttempt ja
             JOIN UserQuest uq ON uq.id = ja.userQuestId
             JOIN Quest q ON q.id = uq.questId
             WHERE uq.userId = ? AND ja.status = 'started'`
        )
        .bind(userId)
        .first<{ id: string; questId: string; questName: string }>();
    if (activeAttempt) {
        const error =
            activeAttempt.questId === questId
                ? "A journey is already in progress for this quest"
                : `You already have a journey in progress for "${activeAttempt.questName}" — finish that one before starting a new one`;
        return NextResponse.json({ error, activeJourneyAttemptId: activeAttempt.id }, { status: 409 });
    }

    const now = new Date().toISOString();

    let userQuest = await env.DB
        .prepare(`SELECT id FROM UserQuest WHERE userId = ? AND questId = ?`)
        .bind(userId, questId)
        .first<{ id: string }>();

    if (!userQuest) {
        const userQuestId = crypto.randomUUID();
        await env.DB
            .prepare(`INSERT INTO UserQuest (id, userId, questId, status, createdAt) VALUES (?, ?, ?, ?, ?)`)
            .bind(userQuestId, userId, questId, "in_progress", now)
            .run();
        userQuest = { id: userQuestId };
    }

    const journeyAttempt: JourneyAttemptRow = {
        id: crypto.randomUUID(),
        userQuestId: userQuest.id,
        currentStepSequence: 0,
        status: "started",
        createdAt: now,
        startedAt: now,
        endedAt: null,
    };

    const blueprints = withArtificialPhotoCheckpoints(overviewSteps);
    const steps: JourneyStepRow[] = blueprints.map((step, index) => ({
        id: crypto.randomUUID(),
        journeyAttemptId: journeyAttempt.id,
        sequence: index + 1,
        name: step.name,
        description: step.description,
        type: step.type,
        lat: step.lat,
        lng: step.lng,
        radiusMeters: step.radiusMeters,
        status: "waiting",
    }));

    await env.DB.batch([
        env.DB
            .prepare(
                `INSERT INTO JourneyAttempt (id, userQuestId, currentStepSequence, status, createdAt, startedAt, endedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
                journeyAttempt.id,
                journeyAttempt.userQuestId,
                journeyAttempt.currentStepSequence,
                journeyAttempt.status,
                journeyAttempt.createdAt,
                journeyAttempt.startedAt,
                journeyAttempt.endedAt
            ),
        ...steps.map((step) =>
            env.DB
                .prepare(
                    `INSERT INTO JourneyStep (id, journeyAttemptId, sequence, name, description, type, lat, lng, radiusMeters, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .bind(
                    step.id,
                    step.journeyAttemptId,
                    step.sequence,
                    step.name,
                    step.description,
                    step.type,
                    step.lat,
                    step.lng,
                    step.radiusMeters,
                    step.status
                )
        ),
    ]);

    // The subset of steps the phone should actually register CLCircularRegions for —
    // every step with a location, real or artificial, each carrying the same radius the
    // server itself will check against in POST .../advance.
    const geofences = steps
        .filter((step): step is JourneyStepRow & { lat: number; lng: number; radiusMeters: number } => step.lat != null && step.lng != null && step.radiusMeters != null)
        .map((step) => ({ stepId: step.id, sequence: step.sequence, lat: step.lat, lng: step.lng, radiusMeters: step.radiusMeters }));

    return NextResponse.json({ journeyAttempt, steps, geofences }, { status: 201 });
}
