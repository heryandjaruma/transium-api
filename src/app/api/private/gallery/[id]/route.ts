import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";
import { r2KeyFromMediaUrl } from "@/lib/media-storage";

type Params = { params: Promise<{ id: string }> };

/**
 * Downloads a single photo from the caller's gallery. `id` is the Media id, and must
 * belong to one of the caller's own journey steps. Streams the R2 object back with
 * `Content-Disposition: attachment` so it saves as a file rather than rendering inline.
 */
export async function GET(request: NextRequest, { params }: Params) {
    const { id } = await params;
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { env } = getCloudflareContext();

    const media = await env.DB
        .prepare(
            `SELECT m.id, m.type, m.url
             FROM Media m
             JOIN JourneyMedia jm ON jm.mediaId = m.id
             JOIN JourneyStep js ON js.id = jm.journeyStepId
             JOIN JourneyAttempt ja ON ja.id = js.journeyAttemptId
             JOIN UserQuest uq ON uq.id = ja.userQuestId
             WHERE m.id = ? AND uq.userId = ?`
        )
        .bind(id, session.user.id)
        .first<{ id: string; type: string; url: string }>();
    if (!media) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

    const key = r2KeyFromMediaUrl(media.url);
    const object = await env.TILES_BUCKET.get(key);
    if (!object) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

    const filename = key.split("/").pop() ?? `${media.id}`;

    const headers = new Headers();
    headers.set("content-type", object.httpMetadata?.contentType ?? media.type ?? "application/octet-stream");
    headers.set("content-length", String(object.size));
    headers.set("content-disposition", `attachment; filename="${filename}"`);
    headers.set("etag", object.httpEtag);
    headers.set("x-content-type-options", "nosniff");

    return new Response(object.body, { status: 200, headers });
}
