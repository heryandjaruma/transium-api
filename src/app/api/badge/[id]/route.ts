import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { r2KeyFromMediaUrl } from "@/lib/media-storage";

type Params = { params: Promise<{ id: string }> };
type BadgeRow = { id: string; name: string; category: string; description: string; type: string; imageUrl: string | null };

const UPDATABLE_FIELDS = ["name", "category", "description", "type"] as const;

/** Returns a single badge. */
export async function GET(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const badge = await env.DB
        .prepare(`SELECT id, name, category, description, type, imageUrl FROM Badge WHERE id = ?`)
        .bind(id)
        .first<BadgeRow>();
    if (!badge) return NextResponse.json({ error: "Badge not found" }, { status: 404 });

    return NextResponse.json({ badge });
}

/** Updates a badge. Body may include any of `{ name, category, description, type }`. Use /api/badge/media to change the image. */
export async function PATCH(request: NextRequest, { params }: Params) {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const fields: string[] = [];
    const values: string[] = [];
    for (const key of UPDATABLE_FIELDS) {
        const value = (body as Record<string, unknown>)[key];
        if (value === undefined) continue;
        if (typeof value !== "string" || !value.trim()) {
            return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
        }
        fields.push(`${key} = ?`);
        values.push(value.trim());
    }

    if (fields.length === 0) {
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const existing = await env.DB.prepare(`SELECT id FROM Badge WHERE id = ?`).bind(id).first();
    if (!existing) return NextResponse.json({ error: "Badge not found" }, { status: 404 });

    await env.DB.prepare(`UPDATE Badge SET ${fields.join(", ")} WHERE id = ?`).bind(...values, id).run();

    const badge = await env.DB
        .prepare(`SELECT id, name, category, description, type, imageUrl FROM Badge WHERE id = ?`)
        .bind(id)
        .first<BadgeRow>();
    return NextResponse.json({ badge });
}

/** Deletes a badge, its steps, and its uploaded image, if any. */
export async function DELETE(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const existing = await env.DB.prepare(`SELECT id, imageUrl FROM Badge WHERE id = ?`).bind(id).first<{ id: string; imageUrl: string | null }>();
    if (!existing) return NextResponse.json({ error: "Badge not found" }, { status: 404 });

    await env.DB.batch([
        env.DB.prepare(`DELETE FROM BadgeAction WHERE badgeId = ?`).bind(id),
        env.DB.prepare(`DELETE FROM Badge WHERE id = ?`).bind(id),
    ]);
    if (existing.imageUrl) {
        await env.TILES_BUCKET.delete(r2KeyFromMediaUrl(existing.imageUrl));
    }

    return new NextResponse(null, { status: 204 });
}
