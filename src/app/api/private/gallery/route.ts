import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";

type GalleryItemRow = {
    id: string;
    type: string;
    url: string;
    createdAt: string;
    journeyStepId: string;
    journeyStepName: string;
    journeyStepSequence: number;
    journeyAttemptId: string;
    questId: string;
    questName: string;
};

/**
 * Returns every photo the caller has uploaded to any of their journey steps, across
 * every journey attempt, most recent first. Each entry carries enough context (quest
 * and journey step names) to group/label them in a gallery view without extra lookups.
 */
export async function GET(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { env } = getCloudflareContext();

    const { results } = await env.DB
        .prepare(
            `SELECT m.id, m.type, m.url, m.createdAt,
                    js.id as journeyStepId, js.name as journeyStepName, js.sequence as journeyStepSequence,
                    ja.id as journeyAttemptId,
                    uq.questId, q.name as questName
             FROM Media m
             JOIN JourneyMedia jm ON jm.mediaId = m.id
             JOIN JourneyStep js ON js.id = jm.journeyStepId
             JOIN JourneyAttempt ja ON ja.id = js.journeyAttemptId
             JOIN UserQuest uq ON uq.id = ja.userQuestId
             JOIN Quest q ON q.id = uq.questId
             WHERE uq.userId = ?
             ORDER BY m.createdAt DESC`
        )
        .bind(session.user.id)
        .all<GalleryItemRow>();

    return NextResponse.json({ media: results });
}
