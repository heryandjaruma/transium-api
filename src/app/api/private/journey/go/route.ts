import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";

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
    status: string;
};

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
 * `status: "waiting"`.
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

    const steps: JourneyStepRow[] = overviewSteps.map((step, index) => ({
        id: crypto.randomUUID(),
        journeyAttemptId: journeyAttempt.id,
        sequence: index + 1,
        name: step.actionName,
        description: step.instruction ?? step.actionDescription,
        type: step.type,
        lat: step.lat,
        lng: step.lng,
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
                    `INSERT INTO JourneyStep (id, journeyAttemptId, sequence, name, description, type, lat, lng, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .bind(step.id, step.journeyAttemptId, step.sequence, step.name, step.description, step.type, step.lat, step.lng, step.status)
        ),
    ]);

    return NextResponse.json({ journeyAttempt, steps }, { status: 201 });
}
