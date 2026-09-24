import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";

type QuestRow = {
    id: string;
    name: string;
    category: string;
    description: string;
    xp: number;
    label: string | null;
    userQuestStatus: string | null;
};
type MediaRow = { id: string; createdAt: string; type: string; url: string; alt: string | null; copyright: string | null };

/** Attaches each quest's thumbnail media (via QuestMedia) in a single query. */
async function attachThumbnails(db: D1Database, quests: QuestRow[]) {
    if (quests.length === 0) return [];

    const placeholders = quests.map(() => "?").join(", ");
    const res = await db
        .prepare(
            `SELECT qm.questId as questId, m.id as id, m.createdAt as createdAt, m.type as type, m.url as url, m.alt as alt, m.copyright as copyright
             FROM QuestMedia qm JOIN Media m ON m.id = qm.mediaId
             WHERE qm.questId IN (${placeholders})`
        )
        .bind(...quests.map((q) => q.id))
        .all<MediaRow & { questId: string }>();

    const thumbnailsByQuest = new Map<string, MediaRow[]>();
    for (const { questId, ...media } of res.results) {
        if (!thumbnailsByQuest.has(questId)) thumbnailsByQuest.set(questId, []);
        thumbnailsByQuest.get(questId)!.push(media);
    }

    return quests.map((quest) => ({ ...quest, thumbnails: thumbnailsByQuest.get(quest.id) ?? [] }));
}

/**
 * Returns quests the caller has not yet completed — every Quest without a UserQuest
 * row of `status: "completed"` for the caller — each with its thumbnail media and
 * `userQuestStatus`: the caller's UserQuest.status for that quest (e.g. "bookmarked",
 * "in_progress"), or `null` if they've never touched it. This is the "what can I do
 * now" list: quests the caller has never touched, bookmarked, or has in progress all
 * still show up here, only finished ones drop off. Query: `label?` — filters to
 * quests with that exact label (e.g. "recommended"), same as GET /quest.
 */
export async function GET(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const label = request.nextUrl.searchParams.get("label");
    const { env } = getCloudflareContext();

    const query = `
        SELECT q.id as id, q.name as name, q.category as category, q.description as description, q.xp as xp,
               q.label as label, uq.status as userQuestStatus
        FROM Quest q
        LEFT JOIN UserQuest uq ON uq.questId = q.id AND uq.userId = ?
        WHERE (uq.status IS NULL OR uq.status != 'completed')${label ? " AND q.label = ?" : ""}
    `;
    const stmt = label ? env.DB.prepare(query).bind(session.user.id, label) : env.DB.prepare(query).bind(session.user.id);
    const res = await stmt.all<QuestRow>();

    const quests = await attachThumbnails(env.DB, res.results);
    return NextResponse.json({ quests });
}
