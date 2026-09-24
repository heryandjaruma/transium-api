import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { kelurahanMediaKey, mediaUrlForKey, pruneOrphanedKelurahanMedia } from "@/lib/media-storage";

// Thumbnails only — no SVG (inline scripts) and no arbitrary types, since this
// endpoint is unauthenticated. Same caveat as /api/quest/media.
const ALLOWED_TYPES: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
};

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

/** Uploads a thumbnail image to R2 (under `media/system/kelurahan/<kelurahanId>/`) and links it to a kelurahan. Form fields: `kelurahanId`, `file`, `alt?`, `copyright?`. */
export async function POST(request: NextRequest) {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

    const kelurahanId = form.get("kelurahanId");
    const file = form.get("file");
    const alt = form.get("alt");
    const copyright = form.get("copyright");

    if (typeof kelurahanId !== "string" || !kelurahanId.trim()) {
        return NextResponse.json({ error: "Missing kelurahanId" }, { status: 400 });
    }
    if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (alt !== null && typeof alt !== "string") {
        return NextResponse.json({ error: "Invalid alt" }, { status: 400 });
    }
    if (copyright !== null && typeof copyright !== "string") {
        return NextResponse.json({ error: "Invalid copyright" }, { status: 400 });
    }

    const extension = ALLOWED_TYPES[file.type];
    if (!extension) {
        return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "File too large" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const kelurahan = await env.DB.prepare(`SELECT id FROM Kelurahan WHERE id = ?`).bind(kelurahanId).first();
    if (!kelurahan) return NextResponse.json({ error: "Kelurahan not found" }, { status: 404 });

    const mediaId = crypto.randomUUID();
    const key = kelurahanMediaKey(kelurahanId, `${mediaId}.${extension}`);

    await env.TILES_BUCKET.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
    });

    const media = {
        id: mediaId,
        createdAt: new Date().toISOString(),
        type: file.type,
        url: mediaUrlForKey(key),
        alt: alt?.trim() || null,
        copyright: copyright?.trim() || null,
    };

    await env.DB.batch([
        env.DB
            .prepare(`INSERT INTO Media (id, createdAt, type, url, alt, copyright) VALUES (?, ?, ?, ?, ?, ?)`)
            .bind(media.id, media.createdAt, media.type, media.url, media.alt, media.copyright),
        env.DB.prepare(`INSERT INTO KelurahanMedia (id, kelurahanId, mediaId) VALUES (?, ?, ?)`).bind(crypto.randomUUID(), kelurahanId, mediaId),
    ]);

    return NextResponse.json({ media }, { status: 201 });
}

/** Updates a thumbnail's `alt` and/or `copyright` text. Body: `{ kelurahanId, mediaId, alt?, copyright? }`. Either accepts a string or `null` to clear it. */
export async function PATCH(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }
    const { kelurahanId, mediaId, alt, copyright } = body as Record<string, unknown>;

    if (typeof kelurahanId !== "string" || !kelurahanId.trim() || typeof mediaId !== "string" || !mediaId.trim()) {
        return NextResponse.json({ error: "Missing kelurahanId or mediaId" }, { status: 400 });
    }
    if (alt !== undefined && alt !== null && typeof alt !== "string") {
        return NextResponse.json({ error: "Invalid alt" }, { status: 400 });
    }
    if (copyright !== undefined && copyright !== null && typeof copyright !== "string") {
        return NextResponse.json({ error: "Invalid copyright" }, { status: 400 });
    }

    const fields: string[] = [];
    const values: (string | null)[] = [];
    if (alt !== undefined) {
        fields.push("alt = ?");
        values.push(typeof alt === "string" ? alt.trim() || null : null);
    }
    if (copyright !== undefined) {
        fields.push("copyright = ?");
        values.push(typeof copyright === "string" ? copyright.trim() || null : null);
    }
    if (fields.length === 0) {
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const link = await env.DB.prepare(`SELECT id FROM KelurahanMedia WHERE kelurahanId = ? AND mediaId = ?`).bind(kelurahanId, mediaId).first();
    if (!link) return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });

    await env.DB.prepare(`UPDATE Media SET ${fields.join(", ")} WHERE id = ?`).bind(...values, mediaId).run();

    const media = await env.DB
        .prepare(`SELECT id, createdAt, type, url, alt, copyright FROM Media WHERE id = ?`)
        .bind(mediaId)
        .first();

    return NextResponse.json({ media });
}

/** Detaches a thumbnail from a kelurahan, deleting the underlying file if no other kelurahan uses it. Query: `kelurahanId`, `mediaId`. */
export async function DELETE(request: NextRequest) {
    const kelurahanId = request.nextUrl.searchParams.get("kelurahanId");
    const mediaId = request.nextUrl.searchParams.get("mediaId");
    if (!kelurahanId || !mediaId) {
        return NextResponse.json({ error: "Missing kelurahanId or mediaId" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const link = await env.DB.prepare(`SELECT id FROM KelurahanMedia WHERE kelurahanId = ? AND mediaId = ?`).bind(kelurahanId, mediaId).first();
    if (!link) return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });

    await env.DB.prepare(`DELETE FROM KelurahanMedia WHERE kelurahanId = ? AND mediaId = ?`).bind(kelurahanId, mediaId).run();
    await pruneOrphanedKelurahanMedia(env.DB, env.TILES_BUCKET, [mediaId]);

    return new NextResponse(null, { status: 204 });
}
