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

/**
 * Returns the caller's journey attempts, most recent first. Query: `status?` — filters
 * to attempts with that JourneyAttempt.status (e.g. "started").
 */
export async function GET(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const status = request.nextUrl.searchParams.get("status");
    const { env } = getCloudflareContext();

    const query = `
        SELECT ja.id, ja.userQuestId, uq.questId, q.name as questName, q.category as questCategory,
               ja.currentStepSequence, ja.status, ja.createdAt, ja.startedAt, ja.endedAt
        FROM JourneyAttempt ja
        JOIN UserQuest uq ON uq.id = ja.userQuestId
        JOIN Quest q ON q.id = uq.questId
        WHERE uq.userId = ?${status ? " AND ja.status = ?" : ""}
        ORDER BY ja.createdAt DESC
    `;
    const stmt = status ? env.DB.prepare(query).bind(session.user.id, status) : env.DB.prepare(query).bind(session.user.id);
    const res = await stmt.all<JourneyAttemptRow>();

    return NextResponse.json({ journeyAttempts: res.results });
}
