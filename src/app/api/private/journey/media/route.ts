import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";
import { journeyMediaKey, mediaUrlForKey } from "@/lib/media-storage";

const ALLOWED_TYPES: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
};

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Uploads a photo for a journey step to R2 (under
 * `media/user/<userId>/journey/<journeyAttemptId>/`) and links it via JourneyMedia.
 * Form fields: `journeyStepId`, `file`. Requires authentication; the step must belong
 * to one of the caller's own journey attempts.
 */
export async function POST(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

    const journeyStepId = form.get("journeyStepId");
    const file = form.get("file");

    if (typeof journeyStepId !== "string" || !journeyStepId.trim()) {
        return NextResponse.json({ error: "Missing journeyStepId" }, { status: 400 });
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

    const journeyStep = await env.DB
        .prepare(
            `SELECT js.id, js.journeyAttemptId
             FROM JourneyStep js
             JOIN JourneyAttempt ja ON ja.id = js.journeyAttemptId
             JOIN UserQuest uq ON uq.id = ja.userQuestId
             WHERE js.id = ? AND uq.userId = ?`
        )
        .bind(journeyStepId, session.user.id)
        .first<{ id: string; journeyAttemptId: string }>();
    if (!journeyStep) return NextResponse.json({ error: "Journey step not found" }, { status: 404 });

    const mediaId = crypto.randomUUID();
    const key = journeyMediaKey(session.user.id, journeyStep.journeyAttemptId, `${mediaId}.${extension}`);

    await env.TILES_BUCKET.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
    });

    const media = { id: mediaId, createdAt: new Date().toISOString(), type: file.type, url: mediaUrlForKey(key) };

    await env.DB.batch([
        env.DB
            .prepare(`INSERT INTO Media (id, createdAt, type, url) VALUES (?, ?, ?, ?)`)
            .bind(media.id, media.createdAt, media.type, media.url),
        env.DB
            .prepare(`INSERT INTO JourneyMedia (id, journeyStepId, mediaId) VALUES (?, ?, ?)`)
            .bind(crypto.randomUUID(), journeyStepId, mediaId),
    ]);

    return NextResponse.json({ media }, { status: 201 });
}
