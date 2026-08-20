// Shared helpers for media uploaded to the "transium" R2 bucket under
// "media/system/..." (app-authored content) and "media/user/..." (user
// uploads). The public URL mirrors the R2 key 1:1 (served by
// src/app/media/[...key]/route.ts).

import { chunk } from "@/lib/utils"

export type MediaAsset = {
    id: string
    createdAt: string
    type: string
    url: string
    alt: string | null
    copyright: string | null
}

// D1 caps bound parameters per query at ~100.
const ID_CHUNK_SIZE = 90

export const QUEST_MEDIA_PREFIX = "media/system/quest"
export const BADGE_MEDIA_PREFIX = "media/system/badge"
export const KELURAHAN_MEDIA_PREFIX = "media/system/kelurahan"
export const USER_JOURNEY_MEDIA_PREFIX = "media/user"

export function questMediaKey(questId: string, filename: string) {
    return `${QUEST_MEDIA_PREFIX}/${questId}/${filename}`
}

export function kelurahanMediaKey(kelurahanId: string, filename: string) {
    return `${KELURAHAN_MEDIA_PREFIX}/${kelurahanId}/${filename}`
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

/** Bulk-fetches each quest's thumbnails via QuestMedia, batching to stay under D1's bound-parameter limit. */
export async function fetchQuestThumbnails(db: D1Database, questIds: string[]): Promise<Map<string, MediaAsset[]>> {
    const map = new Map<string, MediaAsset[]>()
    for (const ids of chunk(questIds, ID_CHUNK_SIZE)) {
        const placeholders = ids.map(() => "?").join(", ")
        const res = await db
            .prepare(
                `SELECT qm.questId as questId, m.id as id, m.createdAt as createdAt, m.type as type, m.url as url, m.alt as alt, m.copyright as copyright
                 FROM QuestMedia qm JOIN Media m ON m.id = qm.mediaId
                 WHERE qm.questId IN (${placeholders})`
            )
            .bind(...ids)
            .all<MediaAsset & { questId: string }>()
        for (const { questId, ...media } of res.results) {
            if (!map.has(questId)) map.set(questId, [])
            map.get(questId)!.push(media)
        }
    }
    return map
}

/** Bulk-fetches each kelurahan's thumbnails via KelurahanMedia, batching to stay under D1's bound-parameter limit. */
export async function fetchKelurahanThumbnails(db: D1Database, kelurahanIds: string[]): Promise<Map<string, MediaAsset[]>> {
    const map = new Map<string, MediaAsset[]>()
    for (const ids of chunk(kelurahanIds, ID_CHUNK_SIZE)) {
        const placeholders = ids.map(() => "?").join(", ")
        const res = await db
            .prepare(
                `SELECT km.kelurahanId as kelurahanId, m.id as id, m.createdAt as createdAt, m.type as type, m.url as url, m.alt as alt, m.copyright as copyright
                 FROM KelurahanMedia km JOIN Media m ON m.id = km.mediaId
                 WHERE km.kelurahanId IN (${placeholders})`
            )
            .bind(...ids)
            .all<MediaAsset & { kelurahanId: string }>()
        for (const { kelurahanId, ...media } of res.results) {
            if (!map.has(kelurahanId)) map.set(kelurahanId, [])
            map.get(kelurahanId)!.push(media)
        }
    }
    return map
}

/**
 * Deletes Media rows (and their R2 objects) that are no longer referenced by
 * any KelurahanMedia link. Call after removing KelurahanMedia rows.
 */
export async function pruneOrphanedKelurahanMedia(db: D1Database, bucket: R2Bucket, mediaIds: string[]) {
    const candidates = [...new Set(mediaIds)]
    if (candidates.length === 0) return

    const placeholders = candidates.map(() => "?").join(", ")
    const stillLinked = await db
        .prepare(`SELECT DISTINCT mediaId FROM KelurahanMedia WHERE mediaId IN (${placeholders})`)
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
