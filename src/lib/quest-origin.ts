export type LatLng = { lat: number; lng: number }

/** Parses a "lat,lng" query param value. Returns `null` if missing or malformed. */
export function parseLatLng(value: string | null): LatLng | null {
    if (!value) return null
    const parts = value.split(",").map(Number)
    if (parts.length !== 2 || !parts.every(Number.isFinite)) return null
    const [lat, lng] = parts
    return { lat, lng }
}

/**
 * Returns each quest's "origin" coordinate: the first BadgeAction with a lat/lng
 * across its attached badges, in badge-attachment then step-sequence order — the same
 * point GET /quest/{id} uses for QuestDetail.origin. Quests with no located step are
 * omitted from the returned map.
 */
export async function getQuestOrigins(db: D1Database, questIds: string[]): Promise<Map<string, LatLng>> {
    const origins = new Map<string, LatLng>()
    if (questIds.length === 0) return origins

    const placeholders = questIds.map(() => "?").join(", ")
    const res = await db
        .prepare(
            `SELECT qb.questId as questId, ba.lat as lat, ba.lng as lng
             FROM QuestBadge qb
             JOIN BadgeAction ba ON ba.badgeId = qb.badgeId
             WHERE qb.questId IN (${placeholders}) AND ba.lat IS NOT NULL AND ba.lng IS NOT NULL
             ORDER BY qb.questId, qb.rowid, ba.sequence`
        )
        .bind(...questIds)
        .all<{ questId: string; lat: number; lng: number }>()

    for (const row of res.results) {
        if (!origins.has(row.questId)) origins.set(row.questId, { lat: row.lat, lng: row.lng })
    }
    return origins
}
