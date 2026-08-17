import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type BadgeRow = { id: string; name: string; category: string; description: string; type: string; imageUrl: string | null };

/** Returns all badges. */
export async function GET() {
    const { env } = getCloudflareContext();
    const res = await env.DB.prepare(`SELECT id, name, category, description, type, imageUrl FROM Badge`).all<BadgeRow>();
    return NextResponse.json({ badges: res.results });
}

/** Creates a badge. Body: `{ name, category, description, type }`. */
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const { name, category, description, type } = (body ?? {}) as Record<string, unknown>;

    if (
        typeof name !== "string" || !name.trim() ||
        typeof category !== "string" || !category.trim() ||
        typeof description !== "string" || !description.trim() ||
        typeof type !== "string" || !type.trim()
    ) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const id = crypto.randomUUID();
    const badge: BadgeRow = {
        id,
        name: name.trim(),
        category: category.trim(),
        description: description.trim(),
        type: type.trim(),
        imageUrl: null,
    };

    await env.DB.prepare(`INSERT INTO Badge (id, name, category, description, type, imageUrl) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(badge.id, badge.name, badge.category, badge.description, badge.type, badge.imageUrl)
        .run();

    return NextResponse.json({ badge }, { status: 201 });
}
