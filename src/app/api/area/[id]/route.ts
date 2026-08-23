import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { pruneOrphanedAreaMedia } from "@/lib/media-storage";

type Params = { params: Promise<{ id: string }> };
type AreaRow = { id: string; name: string; description: string | null; category: string | null; lat: number; lng: number };
type MediaRow = { id: string; createdAt: string; type: string; url: string; alt: string | null; copyright: string | null };

const UPDATABLE_STRING_FIELDS = ["name"] as const;
const NULLABLE_STRING_FIELDS = ["description", "category"] as const;
const NUMBER_FIELDS = ["lat", "lng"] as const;

async function getAreaWithThumbnails(db: D1Database, id: string) {
    const area = await db
        .prepare(`SELECT id, name, description, category, lat, lng FROM Area WHERE id = ?`)
        .bind(id)
        .first<AreaRow>();
    if (!area) return null;

    const media = await db
        .prepare(
            `SELECT m.id as id, m.createdAt as createdAt, m.type as type, m.url as url, m.alt as alt, m.copyright as copyright
             FROM AreaMedia am JOIN Media m ON m.id = am.mediaId
             WHERE am.areaId = ?`
        )
        .bind(id)
        .all<MediaRow>();

    return { ...area, thumbnails: media.results };
}

/** Returns a single area with its thumbnail media. */
export async function GET(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const area = await getAreaWithThumbnails(env.DB, id);
    if (!area) return NextResponse.json({ error: "Area not found" }, { status: 404 });

    return NextResponse.json({ area });
}

/**
 * Updates an area. Body may include any of `{ name, lat, lng, description, category }`.
 * `description`/`category` each accept a non-empty string or `null` to clear it.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }
    const bodyRecord = body as Record<string, unknown>;

    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    for (const key of UPDATABLE_STRING_FIELDS) {
        const value = bodyRecord[key];
        if (value === undefined) continue;
        if (typeof value !== "string" || !value.trim()) {
            return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
        }
        fields.push(`${key} = ?`);
        values.push(value.trim());
    }
    for (const key of NUMBER_FIELDS) {
        const value = bodyRecord[key];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
        }
        fields.push(`${key} = ?`);
        values.push(value);
    }
    for (const key of NULLABLE_STRING_FIELDS) {
        if (!(key in bodyRecord)) continue;
        const value = bodyRecord[key];
        if (value !== null && (typeof value !== "string" || !value.trim())) {
            return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
        }
        fields.push(`${key} = ?`);
        values.push(typeof value === "string" ? value.trim() : null);
    }

    if (fields.length === 0) {
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const existing = await env.DB.prepare(`SELECT id FROM Area WHERE id = ?`).bind(id).first();
    if (!existing) return NextResponse.json({ error: "Area not found" }, { status: 404 });

    await env.DB.prepare(`UPDATE Area SET ${fields.join(", ")} WHERE id = ?`).bind(...values, id).run();

    return NextResponse.json({ area: await getAreaWithThumbnails(env.DB, id) });
}

/** Deletes an area, its AreaMedia links (pruning thumbnails no longer used elsewhere), and clears it from any kelurahans that referenced it. */
export async function DELETE(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const existing = await env.DB.prepare(`SELECT id FROM Area WHERE id = ?`).bind(id).first();
    if (!existing) return NextResponse.json({ error: "Area not found" }, { status: 404 });

    const links = await env.DB.prepare(`SELECT mediaId FROM AreaMedia WHERE areaId = ?`).bind(id).all<{ mediaId: string }>();

    await env.DB.batch([
        env.DB.prepare(`DELETE FROM AreaMedia WHERE areaId = ?`).bind(id),
        env.DB.prepare(`UPDATE Kelurahan SET areaId = NULL WHERE areaId = ?`).bind(id),
        env.DB.prepare(`DELETE FROM Area WHERE id = ?`).bind(id),
    ]);

    await pruneOrphanedAreaMedia(env.DB, env.TILES_BUCKET, links.results.map((r) => r.mediaId));

    return new NextResponse(null, { status: 204 });
}
