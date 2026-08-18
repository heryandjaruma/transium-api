import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

type ProfileRow = {
    id: string;
    userId: string;
    firstName: string;
    lastName: string | null;
    level: number;
};

const SELECT_PROFILE = `SELECT id, userId, firstName, lastName, level FROM Profile WHERE userId = ?`;

/**
 * Returns the caller's profile, creating one on first access. Defaults
 * `firstName`/`lastName` from the Better Auth `user.name` (split on the
 * first space) and `level` to 1, since nothing else creates a Profile row.
 */
async function getOrCreateProfile(db: D1Database, userId: string, userName: string): Promise<ProfileRow> {
    const existing = await db.prepare(SELECT_PROFILE).bind(userId).first<ProfileRow>();
    if (existing) return existing;

    const [firstName, ...rest] = userName.trim().split(/\s+/);
    const profile: ProfileRow = {
        id: crypto.randomUUID(),
        userId,
        firstName: firstName || "",
        lastName: rest.length ? rest.join(" ") : null,
        level: 1,
    };
    await db
        .prepare(`INSERT INTO Profile (id, userId, firstName, lastName, level) VALUES (?, ?, ?, ?, ?)`)
        .bind(profile.id, profile.userId, profile.firstName, profile.lastName, profile.level)
        .run();

    return profile;
}

/** Returns the caller's own profile. `id` must be the caller's user id. */
export async function GET(request: NextRequest, { params }: Params) {
    const { id } = await params;
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (id !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { env } = getCloudflareContext();
    const profile = await getOrCreateProfile(env.DB, session.user.id, session.user.name);

    return NextResponse.json({ profile });
}

/**
 * Updates the caller's own profile. `id` must be the caller's user id.
 * Body may include any of `{ firstName, lastName }`. `lastName` accepts a
 * non-empty string or `null` to clear it. `level` is not user-editable.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
    const { id } = await params;
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (id !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }
    const bodyRecord = body as Record<string, unknown>;

    const fields: string[] = [];
    const values: (string | null)[] = [];

    if ("firstName" in bodyRecord) {
        const firstName = bodyRecord.firstName;
        if (typeof firstName !== "string" || !firstName.trim()) {
            return NextResponse.json({ error: "Invalid firstName" }, { status: 400 });
        }
        fields.push("firstName = ?");
        values.push(firstName.trim());
    }
    if ("lastName" in bodyRecord) {
        const lastName = bodyRecord.lastName;
        if (lastName !== null && (typeof lastName !== "string" || !lastName.trim())) {
            return NextResponse.json({ error: "Invalid lastName" }, { status: 400 });
        }
        fields.push("lastName = ?");
        values.push(typeof lastName === "string" ? lastName.trim() : null);
    }

    if (fields.length === 0) {
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    await getOrCreateProfile(env.DB, session.user.id, session.user.name);
    await env.DB.prepare(`UPDATE Profile SET ${fields.join(", ")} WHERE userId = ?`).bind(...values, session.user.id).run();

    const profile = await env.DB.prepare(SELECT_PROFILE).bind(session.user.id).first<ProfileRow>();
    return NextResponse.json({ profile });
}
