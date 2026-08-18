// Shared helpers for media uploaded to the "transium" R2 bucket under
// "media/system/..." (app-authored content) and "media/user/..." (user
// uploads). The public URL mirrors the R2 key 1:1 (served by
// src/app/media/[...key]/route.ts).

export const QUEST_MEDIA_PREFIX = "media/system/quest"
export const BADGE_MEDIA_PREFIX = "media/system/badge"
export const USER_JOURNEY_MEDIA_PREFIX = "media/user"

export function questMediaKey(questId: string, filename: string) {
    return `${QUEST_MEDIA_PREFIX}/${questId}/${filename}`
}

export function badgeMediaKey(badgeId: string, filename: string) {
    return `${BADGE_MEDIA_PREFIX}/${badgeId}/${filename}`
}

export function journeyMediaKey(userId: string, journeyAttemptId: string, filename: string) {
    return `${USER_JOURNEY_MEDIA_PREFIX}/${userId}/journey/${journeyAttemptId}/${filename}`
}

export function userAvatarKey(userId: string, filename: string) {
    return `${USER_JOURNEY_MEDIA_PREFIX}/${userId}/avatar/${filename}`
}

export function mediaUrlForKey(key: string) {
    return `/${key}`
}

export function r2KeyFromMediaUrl(url: string) {
    return url.replace(/^\/+/, "")
}

/**
 * Deletes Media rows (and their R2 objects) that are no longer referenced by
 * any QuestMedia link. Call after removing QuestMedia rows.
 */
export async function pruneOrphanedMedia(db: D1Database, bucket: R2Bucket, mediaIds: string[]) {
    const candidates = [...new Set(mediaIds)]
    if (candidates.length === 0) return

    const placeholders = candidates.map(() => "?").join(", ")
    const stillLinked = await db
        .prepare(`SELECT DISTINCT mediaId FROM QuestMedia WHERE mediaId IN (${placeholders})`)
        .bind(...candidates)
        .all<{ mediaId: string }>()
    const linked = new Set(stillLinked.results.map((r) => r.mediaId))

    const orphanIds = candidates.filter((id) => !linked.has(id))
    if (orphanIds.length === 0) return

    const orphanPlaceholders = orphanIds.map(() => "?").join(", ")
    const orphans = await db
        .prepare(`SELECT id, url FROM Media WHERE id IN (${orphanPlaceholders})`)
        .bind(...orphanIds)
        .all<{ id: string; url: string }>()

    const keys = orphans.results.map((m) => r2KeyFromMediaUrl(m.url))
    if (keys.length > 0) await bucket.delete(keys)

    await db.prepare(`DELETE FROM Media WHERE id IN (${orphanPlaceholders})`).bind(...orphanIds).run()
}
