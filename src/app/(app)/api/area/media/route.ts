import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { areaMediaKey, mediaUrlForKey, pruneOrphanedAreaMedia } from "@/lib/media-storage";

// Thumbnails only — no SVG (inline scripts) and no arbitrary types, since this
// endpoint is unauthenticated. Same caveat as /api/kelurahan/media.
const ALLOWED_TYPES: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
};

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

/** Uploads a thumbnail image to R2 (under `media/system/area/<areaId>/`) and links it to an area. Form fields: `areaId`, `file`, `alt?`, `copyright?`. */
export async function POST(request: NextRequest) {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

    const areaId = form.get("areaId");
    const file = form.get("file");
    const alt = form.get("alt");
    const copyright = form.get("copyright");

    if (typeof areaId !== "string" || !areaId.trim()) {
        return NextResponse.json({ error: "Missing areaId" }, { status: 400 });
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
    const area = await env.DB.prepare(`SELECT id FROM Area WHERE id = ?`).bind(areaId).first();
    if (!area) return NextResponse.json({ error: "Area not found" }, { status: 404 });

    const mediaId = crypto.randomUUID();
    const key = areaMediaKey(areaId, `${mediaId}.${extension}`);

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
        env.DB.prepare(`INSERT INTO AreaMedia (id, areaId, mediaId) VALUES (?, ?, ?)`).bind(crypto.randomUUID(), areaId, mediaId),
    ]);

    return NextResponse.json({ media }, { status: 201 });
}

/** Updates a thumbnail's `alt` and/or `copyright` text. Body: `{ areaId, mediaId, alt?, copyright? }`. Either accepts a string or `null` to clear it. */
export async function PATCH(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }
    const { areaId, mediaId, alt, copyright } = body as Record<string, unknown>;

    if (typeof areaId !== "string" || !areaId.trim() || typeof mediaId !== "string" || !mediaId.trim()) {
        return NextResponse.json({ error: "Missing areaId or mediaId" }, { status: 400 });
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
    const link = await env.DB.prepare(`SELECT id FROM AreaMedia WHERE areaId = ? AND mediaId = ?`).bind(areaId, mediaId).first();
    if (!link) return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });

    await env.DB.prepare(`UPDATE Media SET ${fields.join(", ")} WHERE id = ?`).bind(...values, mediaId).run();

    const media = await env.DB
        .prepare(`SELECT id, createdAt, type, url, alt, copyright FROM Media WHERE id = ?`)
        .bind(mediaId)
        .first();

    return NextResponse.json({ media });
}

/** Detaches a thumbnail from an area, deleting the underlying file if no other area uses it. Query: `areaId`, `mediaId`. */
export async function DELETE(request: NextRequest) {
    const areaId = request.nextUrl.searchParams.get("areaId");
    const mediaId = request.nextUrl.searchParams.get("mediaId");
    if (!areaId || !mediaId) {
        return NextResponse.json({ error: "Missing areaId or mediaId" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const link = await env.DB.prepare(`SELECT id FROM AreaMedia WHERE areaId = ? AND mediaId = ?`).bind(areaId, mediaId).first();
    if (!link) return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });

    await env.DB.prepare(`DELETE FROM AreaMedia WHERE areaId = ? AND mediaId = ?`).bind(areaId, mediaId).run();
    await pruneOrphanedAreaMedia(env.DB, env.TILES_BUCKET, [mediaId]);

    return new NextResponse(null, { status: 204 });
}
