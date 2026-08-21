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

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parsePaginationParam(value: string | null, fallback: number): number | null {
    if (value === null) return fallback;

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
    return parsed;
}

/**
 * Returns a page of photos the caller has uploaded to any of their journey attempts,
 * across every journey attempt, most recent first. Query parameters are `page` (1-based)
 * and `limit` (1–100, default 20). Each entry carries enough context (quest and journey
 * step names) to group/label them in a gallery view without extra lookups.
 * `journeyStepId`/`journeyStepName`/`journeyStepSequence` are null for a photo uploaded
 * against the attempt itself rather than one of its steps (see POST /private/journey/media).
 */
export async function GET(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const page = parsePaginationParam(request.nextUrl.searchParams.get("page"), 1);
    const limit = parsePaginationParam(request.nextUrl.searchParams.get("limit"), DEFAULT_PAGE_SIZE);
    if (page === null || limit === null || limit > MAX_PAGE_SIZE || (page - 1) * limit > Number.MAX_SAFE_INTEGER) {
        return NextResponse.json({ error: "Invalid pagination parameters" }, { status: 400 });
    }

    const offset = (page - 1) * limit;
    const { env } = getCloudflareContext();

    const [mediaResult, countResult] = await Promise.all([
        env.DB
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
                 ORDER BY m.createdAt DESC, m.id DESC
                 LIMIT ? OFFSET ?`
            )
            .bind(session.user.id, limit, offset)
            .all<GalleryItemRow>(),
        env.DB
            .prepare(
                `SELECT COUNT(*) as total
                 FROM Media m
                 JOIN JourneyMedia jm ON jm.mediaId = m.id
                 JOIN JourneyAttempt ja ON ja.id = jm.journeyAttemptId
                 JOIN UserQuest uq ON uq.id = ja.userQuestId
                 JOIN Quest q ON q.id = uq.questId
                 WHERE uq.userId = ?`
            )
            .bind(session.user.id)
            .first<{ total: number }>(),
    ]);

    const total = countResult?.total ?? 0;
    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
        media: mediaResult.results,
        pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1 && total > 0,
        },
    });
}
