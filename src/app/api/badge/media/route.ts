import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { badgeMediaKey, mediaUrlForKey, r2KeyFromMediaUrl } from "@/lib/media-storage";

// Thumbnails only — no SVG (inline scripts) and no arbitrary types, since this
// endpoint is unauthenticated. Same caveat as /api/quest/media.
const ALLOWED_TYPES: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
};

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

/** Uploads a badge image to R2 (under `media/system/badge/<badgeId>/`), replacing any existing one. Form fields: `badgeId`, `file`. */
export async function POST(request: NextRequest) {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

    const badgeId = form.get("badgeId");
    const file = form.get("file");

    if (typeof badgeId !== "string" || !badgeId.trim()) {
        return NextResponse.json({ error: "Missing badgeId" }, { status: 400 });
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
    const badge = await env.DB.prepare(`SELECT id, imageUrl FROM Badge WHERE id = ?`).bind(badgeId).first<{ id: string; imageUrl: string | null }>();
    if (!badge) return NextResponse.json({ error: "Badge not found" }, { status: 404 });

    const key = badgeMediaKey(badgeId, `${crypto.randomUUID()}.${extension}`);
    await env.TILES_BUCKET.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
    });

    const imageUrl = mediaUrlForKey(key);
    await env.DB.prepare(`UPDATE Badge SET imageUrl = ? WHERE id = ?`).bind(imageUrl, badgeId).run();

    if (badge.imageUrl) {
        await env.TILES_BUCKET.delete(r2KeyFromMediaUrl(badge.imageUrl));
    }

    return NextResponse.json({ imageUrl }, { status: 201 });
}

/** Removes a badge's image. Query: `badgeId`. */
export async function DELETE(request: NextRequest) {
    const badgeId = request.nextUrl.searchParams.get("badgeId");
    if (!badgeId) return NextResponse.json({ error: "Missing badgeId" }, { status: 400 });

    const { env } = getCloudflareContext();
    const badge = await env.DB.prepare(`SELECT id, imageUrl FROM Badge WHERE id = ?`).bind(badgeId).first<{ id: string; imageUrl: string | null }>();
    if (!badge) return NextResponse.json({ error: "Badge not found" }, { status: 404 });
    if (!badge.imageUrl) return NextResponse.json({ error: "Badge has no image" }, { status: 404 });

    await env.TILES_BUCKET.delete(r2KeyFromMediaUrl(badge.imageUrl));
    await env.DB.prepare(`UPDATE Badge SET imageUrl = NULL WHERE id = ?`).bind(badgeId).run();

    return new NextResponse(null, { status: 204 });
}
