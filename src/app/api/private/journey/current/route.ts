import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";

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

/**
 * Returns the caller's currently in-progress journey attempt (`status: "started"`), if
 * any, with its ordered steps — a user can only ever have one such attempt at a time
 * (see POST /private/journey/go), so this is a lookup, not a list. `journeyAttempt` is
 * `null` (with an empty `steps`) when the caller has nothing active, e.g. on app launch
 * before deciding whether to resume a journey or offer to start one.
 */
export async function GET(request: NextRequest) {
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
             WHERE uq.userId = ? AND ja.status = 'started'`
        )
        .bind(session.user.id)
        .first<JourneyAttemptRow>();

    if (!journeyAttempt) {
        return NextResponse.json({ journeyAttempt: null, steps: [] });
    }

    const stepsRes = await env.DB
        .prepare(`SELECT id, journeyAttemptId, sequence, name, description, type, lat, lng, status FROM JourneyStep WHERE journeyAttemptId = ? ORDER BY sequence`)
        .bind(journeyAttempt.id)
        .all<JourneyStepRow>();

    return NextResponse.json({ journeyAttempt, steps: stepsRes.results });
}
