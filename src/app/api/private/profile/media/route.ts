import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";
import { mediaUrlForKey, r2KeyFromMediaUrl, userAvatarKey } from "@/lib/media-storage";

const ALLOWED_TYPES: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
};

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Uploads the caller's avatar to R2 (under `media/user/<userId>/avatar/`) and
 * sets it as `user.image`, replacing any previously uploaded one. Form field: `file`.
 * Requires authentication.
 */
export async function POST(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

    const file = form.get("file");
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

    const key = userAvatarKey(session.user.id, `${crypto.randomUUID()}.${extension}`);
    await env.TILES_BUCKET.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
    });

    const image = mediaUrlForKey(key);
    await env.DB.prepare(`UPDATE user SET image = ?, updatedAt = ? WHERE id = ?`).bind(image, new Date().toISOString(), session.user.id).run();

    const previousImage = session.user.image;
    if (previousImage && previousImage.startsWith("/media/user/")) {
        await env.TILES_BUCKET.delete(r2KeyFromMediaUrl(previousImage));
    }

    return NextResponse.json({ image }, { status: 201 });
}

/** Removes the caller's avatar (only if it was one previously uploaded here). Requires authentication. */
export async function DELETE(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const image = session.user.image;
    if (!image) return NextResponse.json({ error: "Profile has no image" }, { status: 404 });

    const { env } = getCloudflareContext();

    if (image.startsWith("/media/user/")) {
        await env.TILES_BUCKET.delete(r2KeyFromMediaUrl(image));
    }
    await env.DB.prepare(`UPDATE user SET image = NULL, updatedAt = ? WHERE id = ?`).bind(new Date().toISOString(), session.user.id).run();

    return new NextResponse(null, { status: 204 });
}
