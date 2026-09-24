import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";

type DeviceTokenRow = {
    id: string;
    environment: string;
    createdAt: string;
    updatedAt: string;
};

const ENVIRONMENTS = new Set(["sandbox", "production"]);

/** Lists the caller's registered devices (one row per APNs device token). */
export async function GET(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { env } = getCloudflareContext();
    const { results } = await env.DB.prepare(`SELECT id, environment, createdAt, updatedAt FROM DeviceToken WHERE userId = ? ORDER BY updatedAt DESC`)
        .bind(session.user.id)
        .all<DeviceTokenRow>();

    return NextResponse.json({ deviceTokens: results });
}

/**
 * Registers (or re-registers) the caller's APNs device token. Call this right
 * after sign-in, and again whenever the OS hands the app a new/rotated token.
 *
 * Body: `{ token: string, environment?: "sandbox" | "production" }`.
 *
 * Keyed by `token`, not by user: if the same physical device token was
 * previously registered under a different user (e.g. a sign-out followed by
 * a different account signing in on the same device), this reassigns it to
 * the caller rather than creating a duplicate row. A user can have any
 * number of tokens registered at once, one per device.
 */
export async function POST(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }
    const { token, environment } = body as Record<string, unknown>;

    if (typeof token !== "string" || !token.trim()) {
        return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }
    if (environment !== undefined && (typeof environment !== "string" || !ENVIRONMENTS.has(environment))) {
        return NextResponse.json({ error: "Invalid environment" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    await env.DB.prepare(
        `INSERT INTO DeviceToken (id, userId, token, environment, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET userId = excluded.userId, environment = excluded.environment, updatedAt = excluded.updatedAt`
    )
        .bind(id, session.user.id, token.trim(), environment ?? "production", now, now)
        .run();

    const deviceToken = await env.DB.prepare(`SELECT id, environment, createdAt, updatedAt FROM DeviceToken WHERE token = ?`)
        .bind(token.trim())
        .first<DeviceTokenRow>();

    return NextResponse.json({ deviceToken }, { status: 200 });
}

/**
 * Unregisters a device token, e.g. on sign-out, so the device stops
 * receiving pushes for the caller. Body: `{ token: string }`. Only removes
 * the token if it belongs to the caller.
 */
export async function DELETE(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }
    const { token } = body as Record<string, unknown>;
    if (typeof token !== "string" || !token.trim()) {
        return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const result = await env.DB.prepare(`DELETE FROM DeviceToken WHERE token = ? AND userId = ?`).bind(token.trim(), session.user.id).run();

    if (result.meta.changes === 0) {
        return NextResponse.json({ error: "Device token not found" }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
}
