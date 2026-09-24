import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type QuestRow = { id: string; name: string; category: string; description: string; xp: number; label: string | null };
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

/** Returns all quests, each with its thumbnail media. Query: `label?` — filters to quests with that exact label (e.g. "recommended"). */
export async function GET(request: NextRequest) {
    const label = request.nextUrl.searchParams.get("label");
    const { env } = getCloudflareContext();

    const query = `SELECT id, name, category, description, xp, label FROM Quest${label ? " WHERE label = ?" : ""}`;
    const stmt = label ? env.DB.prepare(query).bind(label) : env.DB.prepare(query);
    const res = await stmt.all<QuestRow>();

    const quests = await attachThumbnails(env.DB, res.results);
    return NextResponse.json({ quests });
}

/** Creates a quest. Body: `{ name, category, description, xp?, label? }`. `xp` defaults to 0, `label` defaults to `null`. */
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const { name, category, description, xp, label } = (body ?? {}) as Record<string, unknown>;

    if (
        typeof name !== "string" || !name.trim() ||
        typeof category !== "string" || !category.trim() ||
        typeof description !== "string" || !description.trim() ||
        (xp !== undefined && (!Number.isInteger(xp) || (xp as number) < 0)) ||
        (label !== undefined && label !== null && (typeof label !== "string" || !label.trim()))
    ) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const id = crypto.randomUUID();
    const quest: QuestRow = {
        id,
        name: name.trim(),
        category: category.trim(),
        description: description.trim(),
        xp: xp !== undefined ? (xp as number) : 0,
        label: typeof label === "string" ? label.trim() : null,
    };

    await env.DB.prepare(`INSERT INTO Quest (id, name, category, description, xp, label) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(quest.id, quest.name, quest.category, quest.description, quest.xp, quest.label)
        .run();

    return NextResponse.json({ quest: { ...quest, thumbnails: [] } }, { status: 201 });
}
