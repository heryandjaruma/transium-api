import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { areaMediaKey, mediaUrlForKey, r2KeyFromMediaUrl } from "@/lib/media-storage";

// Hero photo only — no SVG (inline scripts) and no arbitrary types, since this
// endpoint is unauthenticated. Same caveat as /api/area/media.
const ALLOWED_TYPES: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
};

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

/** Uploads an area's hero photo to R2 (under `media/system/area/<areaId>/`), replacing any existing one. Form fields: `areaId`, `file`. */
export async function POST(request: NextRequest) {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

    const areaId = form.get("areaId");
    const file = form.get("file");

    if (typeof areaId !== "string" || !areaId.trim()) {
        return NextResponse.json({ error: "Missing areaId" }, { status: 400 });
    }
    if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const extension = ALLOWED_TYPES[file.type];
    if (!extension) {
        return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "File too large" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const area = await env.DB.prepare(`SELECT id, photoUrl FROM Area WHERE id = ?`).bind(areaId).first<{ id: string; photoUrl: string | null }>();
    if (!area) return NextResponse.json({ error: "Area not found" }, { status: 404 });

    const key = areaMediaKey(areaId, `${crypto.randomUUID()}.${extension}`);
    await env.TILES_BUCKET.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
    });

    const photoUrl = mediaUrlForKey(key);
    await env.DB.prepare(`UPDATE Area SET photoUrl = ? WHERE id = ?`).bind(photoUrl, areaId).run();

    if (area.photoUrl) {
        await env.TILES_BUCKET.delete(r2KeyFromMediaUrl(area.photoUrl));
    }

    return NextResponse.json({ photoUrl }, { status: 201 });
}

/** Removes an area's hero photo. Query: `areaId`. */
export async function DELETE(request: NextRequest) {
    const areaId = request.nextUrl.searchParams.get("areaId");
    if (!areaId) return NextResponse.json({ error: "Missing areaId" }, { status: 400 });

    const { env } = getCloudflareContext();
    const area = await env.DB.prepare(`SELECT id, photoUrl FROM Area WHERE id = ?`).bind(areaId).first<{ id: string; photoUrl: string | null }>();
    if (!area) return NextResponse.json({ error: "Area not found" }, { status: 404 });
    if (!area.photoUrl) return NextResponse.json({ error: "Area has no photo" }, { status: 404 });

    await env.TILES_BUCKET.delete(r2KeyFromMediaUrl(area.photoUrl));
    await env.DB.prepare(`UPDATE Area SET photoUrl = NULL WHERE id = ?`).bind(areaId).run();

    return new NextResponse(null, { status: 204 });
}
