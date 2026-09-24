import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { r2KeyFromMediaUrl } from "@/lib/media-storage";

type Params = { params: Promise<{ id: string }> };
type BadgeRow = {
    id: string;
    name: string;
    category: string;
    description: string;
    type: string;
    imageUrl: string | null;
    kelurahanId: string | null;
};

const SELECT_BADGE = `SELECT id, name, category, description, type, imageUrl, kelurahanId FROM Badge WHERE id = ?`;
const UPDATABLE_FIELDS = ["name", "category", "description", "type"] as const;

/** Returns a single badge. */
export async function GET(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const badge = await env.DB.prepare(SELECT_BADGE).bind(id).first<BadgeRow>();
    if (!badge) return NextResponse.json({ error: "Badge not found" }, { status: 404 });

    return NextResponse.json({ badge });
}

/**
 * Updates a badge. Body may include any of `{ name, category, description, type, kelurahanId }`.
 * `kelurahanId` accepts a valid id or `null` to clear it. Use /api/badge/media to change the image.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }
    const bodyRecord = body as Record<string, unknown>;

    const fields: string[] = [];
    const values: (string | null)[] = [];
    for (const key of UPDATABLE_FIELDS) {
        const value = bodyRecord[key];
        if (value === undefined) continue;
        if (typeof value !== "string" || !value.trim()) {
            return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
        }
        fields.push(`${key} = ?`);
        values.push(value.trim());
    }

    const { env } = getCloudflareContext();

    if ("kelurahanId" in bodyRecord) {
        const kelurahanId = bodyRecord.kelurahanId;
        if (kelurahanId !== null && typeof kelurahanId !== "string") {
            return NextResponse.json({ error: "Invalid kelurahanId" }, { status: 400 });
        }
        if (kelurahanId) {
            const kelurahan = await env.DB.prepare(`SELECT id FROM Kelurahan WHERE id = ?`).bind(kelurahanId).first();
            if (!kelurahan) return NextResponse.json({ error: "Kelurahan not found" }, { status: 404 });
        }
        fields.push(`kelurahanId = ?`);
        values.push(kelurahanId);
    }

    if (fields.length === 0) {
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const existing = await env.DB.prepare(`SELECT id FROM Badge WHERE id = ?`).bind(id).first();
    if (!existing) return NextResponse.json({ error: "Badge not found" }, { status: 404 });

    await env.DB.prepare(`UPDATE Badge SET ${fields.join(", ")} WHERE id = ?`).bind(...values, id).run();

    const badge = await env.DB.prepare(SELECT_BADGE).bind(id).first<BadgeRow>();
    return NextResponse.json({ badge });
}

/** Deletes a badge, its steps, its quest links, and its uploaded image, if any. */
export async function DELETE(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const existing = await env.DB.prepare(`SELECT id, imageUrl FROM Badge WHERE id = ?`).bind(id).first<{ id: string; imageUrl: string | null }>();
    if (!existing) return NextResponse.json({ error: "Badge not found" }, { status: 404 });

    await env.DB.batch([
        env.DB.prepare(`DELETE FROM BadgeAction WHERE badgeId = ?`).bind(id),
        env.DB.prepare(`DELETE FROM QuestBadge WHERE badgeId = ?`).bind(id),
        env.DB.prepare(`DELETE FROM Badge WHERE id = ?`).bind(id),
    ]);
    if (existing.imageUrl) {
        await env.TILES_BUCKET.delete(r2KeyFromMediaUrl(existing.imageUrl));
    }

    return new NextResponse(null, { status: 204 });
}
