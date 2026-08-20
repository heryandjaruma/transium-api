import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { pruneOrphanedKelurahanMedia } from "@/lib/media-storage";

type Params = { params: Promise<{ id: string }> };
type KelurahanRow = { id: string; kelurahanName: string; kecamatanName: string; description: string | null; category: string | null };
type MediaRow = { id: string; createdAt: string; type: string; url: string; alt: string | null; copyright: string | null };

const UPDATABLE_STRING_FIELDS = ["kelurahanName", "kecamatanName"] as const;
const NULLABLE_STRING_FIELDS = ["description", "category"] as const;

async function getKelurahanWithThumbnails(db: D1Database, id: string) {
    const kelurahan = await db
        .prepare(`SELECT id, kelurahanName, kecamatanName, description, category FROM Kelurahan WHERE id = ?`)
        .bind(id)
        .first<KelurahanRow>();
    if (!kelurahan) return null;

    const media = await db
        .prepare(
            `SELECT m.id as id, m.createdAt as createdAt, m.type as type, m.url as url, m.alt as alt, m.copyright as copyright
             FROM KelurahanMedia km JOIN Media m ON m.id = km.mediaId
             WHERE km.kelurahanId = ?`
        )
        .bind(id)
        .all<MediaRow>();

    return { ...kelurahan, thumbnails: media.results };
}

/** Returns a single kelurahan with its thumbnail media. */
export async function GET(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const kelurahan = await getKelurahanWithThumbnails(env.DB, id);
    if (!kelurahan) return NextResponse.json({ error: "Kelurahan not found" }, { status: 404 });

    return NextResponse.json({ kelurahan });
}

/**
 * Updates a kelurahan. Body may include any of `{ kelurahanName, kecamatanName, description, category }`.
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
    const values: (string | null)[] = [];
    for (const key of UPDATABLE_STRING_FIELDS) {
        const value = bodyRecord[key];
        if (value === undefined) continue;
        if (typeof value !== "string" || !value.trim()) {
            return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
        }
        fields.push(`${key} = ?`);
        values.push(value.trim());
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
    const existing = await env.DB.prepare(`SELECT id FROM Kelurahan WHERE id = ?`).bind(id).first();
    if (!existing) return NextResponse.json({ error: "Kelurahan not found" }, { status: 404 });

    await env.DB.prepare(`UPDATE Kelurahan SET ${fields.join(", ")} WHERE id = ?`).bind(...values, id).run();

    return NextResponse.json({ kelurahan: await getKelurahanWithThumbnails(env.DB, id) });
}

/** Deletes a kelurahan, its KelurahanMedia links (pruning thumbnails no longer used elsewhere), and clears it from any badges that referenced it. */
export async function DELETE(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const existing = await env.DB.prepare(`SELECT id FROM Kelurahan WHERE id = ?`).bind(id).first();
    if (!existing) return NextResponse.json({ error: "Kelurahan not found" }, { status: 404 });

    const links = await env.DB.prepare(`SELECT mediaId FROM KelurahanMedia WHERE kelurahanId = ?`).bind(id).all<{ mediaId: string }>();

    await env.DB.batch([
        env.DB.prepare(`DELETE FROM KelurahanMedia WHERE kelurahanId = ?`).bind(id),
        env.DB.prepare(`UPDATE Badge SET kelurahanId = NULL WHERE kelurahanId = ?`).bind(id),
        env.DB.prepare(`DELETE FROM Kelurahan WHERE id = ?`).bind(id),
    ]);

    await pruneOrphanedKelurahanMedia(env.DB, env.TILES_BUCKET, links.results.map((r) => r.mediaId));

    return new NextResponse(null, { status: 204 });
}
