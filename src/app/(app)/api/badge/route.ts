import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type BadgeRow = {
    id: string;
    name: string;
    category: string;
    description: string;
    type: string;
    imageUrl: string | null;
    kelurahanId: string | null;
};

/** Returns all badges. */
export async function GET() {
    const { env } = getCloudflareContext();
    const res = await env.DB
        .prepare(`SELECT id, name, category, description, type, imageUrl, kelurahanId FROM Badge`)
        .all<BadgeRow>();
    return NextResponse.json({ badges: res.results });
}

/** Creates a badge. Body: `{ name, category, description, type, kelurahanId? }`. */
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const { name, category, description, type, kelurahanId } = (body ?? {}) as Record<string, unknown>;

    if (
        typeof name !== "string" || !name.trim() ||
        typeof category !== "string" || !category.trim() ||
        typeof description !== "string" || !description.trim() ||
        typeof type !== "string" || !type.trim()
    ) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }
    if (kelurahanId !== undefined && kelurahanId !== null && typeof kelurahanId !== "string") {
        return NextResponse.json({ error: "Invalid kelurahanId" }, { status: 400 });
    }

    const { env } = getCloudflareContext();

    if (kelurahanId) {
        const kelurahan = await env.DB.prepare(`SELECT id FROM Kelurahan WHERE id = ?`).bind(kelurahanId).first();
        if (!kelurahan) return NextResponse.json({ error: "Kelurahan not found" }, { status: 404 });
    }

    const id = crypto.randomUUID();
    const badge: BadgeRow = {
        id,
        name: name.trim(),
        category: category.trim(),
        description: description.trim(),
        type: type.trim(),
        imageUrl: null,
        kelurahanId: typeof kelurahanId === "string" ? kelurahanId : null,
    };

    await env.DB
        .prepare(`INSERT INTO Badge (id, name, category, description, type, imageUrl, kelurahanId) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(badge.id, badge.name, badge.category, badge.description, badge.type, badge.imageUrl, badge.kelurahanId)
        .run();

    return NextResponse.json({ badge }, { status: 201 });
}
