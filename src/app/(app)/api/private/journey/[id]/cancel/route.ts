import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

type JourneyAttemptRow = {
    id: string;
    userQuestId: string;
    questId: string;
    questName: string;
    questCategory: string;
    currentStepSequence: number;
    status: string;
    createdAt: string;
    startedAt: string | null;
    endedAt: string | null;
};

/**
 * Cancels a journey attempt, freeing the caller up to start a new one — a JourneyAttempt
 * with `status: "started"` blocks POST .../go for that user until it's completed or
 * cancelled. Marks the JourneyAttempt `status: "canceled"` with `endedAt`; the parent
 * UserQuest is left as-is (still `status: "in_progress"`) so a later POST .../go for the
 * same quest reuses it rather than creating a duplicate.
 *
 * Idempotent no-op (200, returning the existing attempt unchanged) if the attempt is
 * already `status: "canceled"`. Fails with 409 if the attempt isn't `status: "started"`
 * (e.g. already completed).
 */
export async function POST(request: NextRequest, { params }: Params) {
    const { id } = await params;
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { env } = getCloudflareContext();

    const journeyAttempt = await env.DB
        .prepare(
            `SELECT ja.id, ja.userQuestId, uq.questId, q.name as questName, q.category as questCategory,
                    ja.currentStepSequence, ja.status, ja.createdAt, ja.startedAt, ja.endedAt
             FROM JourneyAttempt ja
             JOIN UserQuest uq ON uq.id = ja.userQuestId
             JOIN Quest q ON q.id = uq.questId
             WHERE ja.id = ? AND uq.userId = ?`
        )
        .bind(id, session.user.id)
        .first<JourneyAttemptRow>();
    if (!journeyAttempt) return NextResponse.json({ error: "Journey not found" }, { status: 404 });

    if (journeyAttempt.status === "canceled") {
        return NextResponse.json({ journeyAttempt });
    }
    if (journeyAttempt.status !== "started") {
        return NextResponse.json({ error: "Journey is not active" }, { status: 409 });
    }

    const now = new Date().toISOString();
    journeyAttempt.status = "canceled";
    journeyAttempt.endedAt = now;

    await env.DB.prepare(`UPDATE JourneyAttempt SET status = 'canceled', endedAt = ? WHERE id = ?`).bind(now, id).run();

    return NextResponse.json({ journeyAttempt });
}
