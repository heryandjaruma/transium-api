import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { pruneOrphanedMedia } from "@/lib/media-storage";

type Params = { params: Promise<{ id: string }> };
type QuestRow = { id: string; name: string; category: string; description: string };
type MediaRow = { id: string; createdAt: string; type: string; url: string };

const UPDATABLE_FIELDS = ["name", "category", "description"] as const;

async function getQuestWithThumbnails(db: D1Database, id: string) {
    const quest = await db.prepare(`SELECT id, name, category, description FROM Quest WHERE id = ?`).bind(id).first<QuestRow>();
    if (!quest) return null;

    const media = await db
        .prepare(
            `SELECT m.id as id, m.createdAt as createdAt, m.type as type, m.url as url
             FROM QuestMedia qm JOIN Media m ON m.id = qm.mediaId
             WHERE qm.questId = ?`
        )
        .bind(id)
        .all<MediaRow>();

    return { ...quest, thumbnails: media.results };
}

/** Returns a single quest with its thumbnail media. */
export async function GET(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const quest = await getQuestWithThumbnails(env.DB, id);
    if (!quest) return NextResponse.json({ error: "Quest not found" }, { status: 404 });

    return NextResponse.json({ quest });
}

/** Updates a quest. Body may include any of `{ name, category, description }`. */
export async function PATCH(request: NextRequest, { params }: Params) {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const fields: string[] = [];
    const values: string[] = [];
    for (const key of UPDATABLE_FIELDS) {
        const value = (body as Record<string, unknown>)[key];
        if (value === undefined) continue;
        if (typeof value !== "string" || !value.trim()) {
            return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
        }
        fields.push(`${key} = ?`);
        values.push(value.trim());
    }

    if (fields.length === 0) {
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const existing = await env.DB.prepare(`SELECT id FROM Quest WHERE id = ?`).bind(id).first();
    if (!existing) return NextResponse.json({ error: "Quest not found" }, { status: 404 });

    await env.DB.prepare(`UPDATE Quest SET ${fields.join(", ")} WHERE id = ?`).bind(...values, id).run();

    return NextResponse.json({ quest: await getQuestWithThumbnails(env.DB, id) });
}

/** Deletes a quest, its QuestMedia links, and any thumbnails no longer used elsewhere. */
export async function DELETE(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const existing = await env.DB.prepare(`SELECT id FROM Quest WHERE id = ?`).bind(id).first();
    if (!existing) return NextResponse.json({ error: "Quest not found" }, { status: 404 });

    const links = await env.DB.prepare(`SELECT mediaId FROM QuestMedia WHERE questId = ?`).bind(id).all<{ mediaId: string }>();

    await env.DB.batch([
        env.DB.prepare(`DELETE FROM QuestMedia WHERE questId = ?`).bind(id),
        env.DB.prepare(`DELETE FROM Quest WHERE id = ?`).bind(id),
    ]);

    await pruneOrphanedMedia(env.DB, env.TILES_BUCKET, links.results.map((r) => r.mediaId));

    return new NextResponse(null, { status: 204 });
}
