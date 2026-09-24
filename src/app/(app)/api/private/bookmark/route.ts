import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";

type BookmarkRow = {
    id: string;
    questId: string;
    questName: string;
    questCategory: string;
    createdAt: string;
};

const SELECT_BOOKMARKS = `
    SELECT uq.id, uq.questId, q.name as questName, q.category as questCategory, uq.createdAt
    FROM UserQuest uq
    JOIN Quest q ON q.id = uq.questId
`;

/** Returns the caller's bookmarked quests, most recent first. */
export async function GET(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { env } = getCloudflareContext();
    const res = await env.DB
        .prepare(`${SELECT_BOOKMARKS} WHERE uq.userId = ? AND uq.status = 'bookmarked' ORDER BY uq.createdAt DESC`)
        .bind(session.user.id)
        .all<BookmarkRow>();

    return NextResponse.json({ bookmarks: res.results });
}

/**
 * Bookmarks a quest for the caller. Body: `{ questId }`. Creates a UserQuest with
 * `status: "bookmarked"`. Fails with 409 if the caller already has a UserQuest for
 * this quest (bookmarked or otherwise in progress).
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

    const existing = await env.DB.prepare(`SELECT id FROM UserQuest WHERE userId = ? AND questId = ?`).bind(userId, questId).first();
    if (existing) return NextResponse.json({ error: "Quest already saved" }, { status: 409 });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB
        .prepare(`INSERT INTO UserQuest (id, userId, questId, status, createdAt, completedAt) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id, userId, questId, "bookmarked", now, null)
        .run();

    const bookmark = await env.DB.prepare(`${SELECT_BOOKMARKS} WHERE uq.id = ?`).bind(id).first<BookmarkRow>();

    return NextResponse.json({ bookmark }, { status: 201 });
}

/**
 * Removes a bookmarked quest for the caller. Body: `{ questId }`. Fails with 409 if
 * the quest has any JourneyAttempt recorded against it, since those reference this
 * UserQuest row.
 */
export async function DELETE(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const { questId } = (body ?? {}) as Record<string, unknown>;

    if (typeof questId !== "string" || !questId.trim()) {
        return NextResponse.json({ error: "Invalid questId" }, { status: 400 });
    }

    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { env } = getCloudflareContext();

    const userQuest = await env.DB
        .prepare(`SELECT id FROM UserQuest WHERE userId = ? AND questId = ?`)
        .bind(session.user.id, questId)
        .first<{ id: string }>();
    if (!userQuest) return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });

    const attempt = await env.DB.prepare(`SELECT id FROM JourneyAttempt WHERE userQuestId = ?`).bind(userQuest.id).first();
    if (attempt) return NextResponse.json({ error: "Cannot remove a quest that has journey attempts" }, { status: 409 });

    await env.DB.prepare(`DELETE FROM UserQuest WHERE id = ?`).bind(userQuest.id).run();

    return new NextResponse(null, { status: 204 });
}
