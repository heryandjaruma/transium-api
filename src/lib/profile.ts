export type ProfileRow = {
    id: string
    userId: string
    firstName: string
    lastName: string | null
    level: number
}

export const SELECT_PROFILE = `SELECT id, userId, firstName, lastName, level FROM Profile WHERE userId = ?`

/**
 * Returns the user's profile, creating one on first access. Defaults
 * `firstName`/`lastName` from the Better Auth `user.name` (split on the
 * first space) and `level` to 1, since nothing else creates a Profile row.
 */
export async function getOrCreateProfile(db: D1Database, userId: string, userName: string): Promise<ProfileRow> {
    const existing = await db.prepare(SELECT_PROFILE).bind(userId).first<ProfileRow>()
    if (existing) return existing

    const [firstName, ...rest] = userName.trim().split(/\s+/)
    const profile: ProfileRow = {
        id: crypto.randomUUID(),
        userId,
        firstName: firstName || "",
        lastName: rest.length ? rest.join(" ") : null,
        level: 1,
    }
    await db
        .prepare(`INSERT INTO Profile (id, userId, firstName, lastName, level) VALUES (?, ?, ?, ?, ?)`)
        .bind(profile.id, profile.userId, profile.firstName, profile.lastName, profile.level)
        .run()

    return profile
}
