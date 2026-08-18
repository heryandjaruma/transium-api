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

type JourneySummaryRow = {
    id: string;
    journeyAttemptId: string;
    stepsTaken: number;
    distanceMeters: number;
    calorie: number;
    startPoint: string;
    finishPoint: string;
};

/** Returns a single journey attempt belonging to the caller, with its steps and summary (if ended). */
export async function GET(request: NextRequest, { params }: Params) {
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

    const stepsRes = await env.DB
        .prepare(`SELECT id, journeyAttemptId, sequence, name, description, type, lat, lng, status FROM JourneyStep WHERE journeyAttemptId = ? ORDER BY sequence`)
        .bind(id)
        .all<JourneyStepRow>();

    const summary = await env.DB
        .prepare(`SELECT id, journeyAttemptId, stepsTaken, distanceMeters, calorie, startPoint, finishPoint FROM JourneySummary WHERE journeyAttemptId = ?`)
        .bind(id)
        .first<JourneySummaryRow>();

    return NextResponse.json({ journeyAttempt, steps: stepsRes.results, summary: summary ?? null });
}
