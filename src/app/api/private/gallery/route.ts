import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";

type GalleryItemRow = {
    id: string;
    type: string;
    url: string;
    createdAt: string;
    journeyStepId: string | null;
    journeyStepName: string | null;
    journeyStepSequence: number | null;
    journeyAttemptId: string;
    questId: string;
    questName: string;
};

/**
 * Returns every photo the caller has uploaded to any of their journey attempts, across
 * every journey attempt, most recent first. Each entry carries enough context (quest
 * and journey step names) to group/label them in a gallery view without extra lookups.
 * `journeyStepId`/`journeyStepName`/`journeyStepSequence` are null for a photo uploaded
 * against the attempt itself rather than one of its steps (see POST /private/journey/media).
 */
export async function GET(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { env } = getCloudflareContext();

    const { results } = await env.DB
        .prepare(
            `SELECT m.id, m.type, m.url, m.createdAt,
                    jm.journeyStepId, js.name as journeyStepName, js.sequence as journeyStepSequence,
                    jm.journeyAttemptId,
                    uq.questId, q.name as questName
             FROM Media m
             JOIN JourneyMedia jm ON jm.mediaId = m.id
             JOIN JourneyAttempt ja ON ja.id = jm.journeyAttemptId
             LEFT JOIN JourneyStep js ON js.id = jm.journeyStepId
             JOIN UserQuest uq ON uq.id = ja.userQuestId
             JOIN Quest q ON q.id = uq.questId
             WHERE uq.userId = ?
             ORDER BY m.createdAt DESC`
        )
        .bind(session.user.id)
        .all<GalleryItemRow>();

    return NextResponse.json({ media: results });
}
