import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";
import { USER_JOURNEY_MEDIA_PREFIX } from "@/lib/media-storage";

const USER_JOURNEY_MEDIA_SUBQUERY = `
    SELECT js.id
    FROM JourneyStep js
    JOIN JourneyAttempt ja ON ja.id = js.journeyAttemptId
    JOIN UserQuest uq ON uq.id = ja.userQuestId
    WHERE uq.userId = ?
`;

const USER_JOURNEY_ATTEMPT_SUBQUERY = `
    SELECT ja.id
    FROM JourneyAttempt ja
    JOIN UserQuest uq ON uq.id = ja.userQuestId
    WHERE uq.userId = ?
`;

/** Deletes every R2 object under this user's media prefix (avatar + journey photos alike). */
async function deleteUserMedia(bucket: R2Bucket, userId: string) {
    const prefix = `${USER_JOURNEY_MEDIA_PREFIX}/${userId}/`;
    let cursor: string | undefined;

    do {
        const listed = await bucket.list({ prefix, cursor });
        if (listed.objects.length > 0) {
            await bucket.delete(listed.objects.map((o) => o.key));
        }
        cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
}

/**
 * Permanently deletes the caller's account and every piece of data associated with it:
 * journey attempts (steps, summary, walked path, photos), quest bookmarks/progress,
 * earned badges, profile, avatar, and the Better Auth identity itself (user, sessions,
 * linked social accounts). This cannot be undone.
 *
 * Nothing is retained to "help" a future re-signup — including the name Apple only ever
 * hands over on the first authorization — since holding onto it after a deletion request
 * would defeat the point of deleting the account.
 */
export async function DELETE(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.user.id;

    const { env } = getCloudflareContext();

    const linkedMedia = await env.DB
        .prepare(
            `SELECT jm.mediaId
             FROM JourneyMedia jm
             JOIN JourneyStep js ON js.id = jm.journeyStepId
             JOIN JourneyAttempt ja ON ja.id = js.journeyAttemptId
             JOIN UserQuest uq ON uq.id = ja.userQuestId
             WHERE uq.userId = ?`
        )
        .bind(userId)
        .all<{ mediaId: string }>();
    const mediaIds = linkedMedia.results.map((r) => r.mediaId);

    const statements = [
        env.DB.prepare(`DELETE FROM UserBadge WHERE userId = ?`).bind(userId),
        env.DB.prepare(`DELETE FROM JourneyMedia WHERE journeyStepId IN (${USER_JOURNEY_MEDIA_SUBQUERY})`).bind(userId),
        ...(mediaIds.length > 0
            ? [env.DB.prepare(`DELETE FROM Media WHERE id IN (${mediaIds.map(() => "?").join(", ")})`).bind(...mediaIds)]
            : []),
        env.DB.prepare(`DELETE FROM JourneyPathPoint WHERE journeyAttemptId IN (${USER_JOURNEY_ATTEMPT_SUBQUERY})`).bind(userId),
        env.DB.prepare(`DELETE FROM JourneyStep WHERE journeyAttemptId IN (${USER_JOURNEY_ATTEMPT_SUBQUERY})`).bind(userId),
        env.DB.prepare(`DELETE FROM JourneySummary WHERE journeyAttemptId IN (${USER_JOURNEY_ATTEMPT_SUBQUERY})`).bind(userId),
        env.DB
            .prepare(`DELETE FROM JourneyAttempt WHERE userQuestId IN (SELECT id FROM UserQuest WHERE userId = ?)`)
            .bind(userId),
        env.DB.prepare(`DELETE FROM UserQuest WHERE userId = ?`).bind(userId),
        env.DB.prepare(`DELETE FROM Profile WHERE userId = ?`).bind(userId),
        // Cascades to session, account, and DeviceToken rows for this user.
        env.DB.prepare(`DELETE FROM user WHERE id = ?`).bind(userId),
    ];

    await env.DB.batch(statements);
    await deleteUserMedia(env.TILES_BUCKET, userId);

    return new NextResponse(null, { status: 204 });
}
