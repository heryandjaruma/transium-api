import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { fetchAreaThumbnails } from "@/lib/media-storage";

type AreaRow = { id: string; name: string; description: string | null; category: string | null; lat: number; lng: number };

/** Returns all areas, each with its thumbnail media. */
export async function GET() {
    const { env } = getCloudflareContext();
    const res = await env.DB.prepare(`SELECT id, name, description, category, lat, lng FROM Area`).all<AreaRow>();

    const thumbnailsByArea = await fetchAreaThumbnails(env.DB, res.results.map((a) => a.id));
    const areas = res.results.map((area) => ({ ...area, thumbnails: thumbnailsByArea.get(area.id) ?? [] }));

    return NextResponse.json({ areas });
}

/**
 * Creates an area. Body: `{ name, lat, lng, description?, category? }`.
 * `lat`/`lng` are the area's center point, used to estimate distance to it later.
 * `category` is a comma-separated list of the majority destination types here, e.g. "Beach,Mountains".
 */
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const { name, lat, lng, description, category } = (body ?? {}) as Record<string, unknown>;

    if (
        typeof name !== "string" || !name.trim() ||
        typeof lat !== "number" || !Number.isFinite(lat) ||
        typeof lng !== "number" || !Number.isFinite(lng) ||
        (description !== undefined && description !== null && (typeof description !== "string" || !description.trim())) ||
        (category !== undefined && category !== null && (typeof category !== "string" || !category.trim()))
    ) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const id = crypto.randomUUID();
    const area: AreaRow = {
        id,
        name: name.trim(),
        description: typeof description === "string" ? description.trim() : null,
        category: typeof category === "string" ? category.trim() : null,
        lat,
        lng,
    };

    await env.DB
        .prepare(`INSERT INTO Area (id, name, description, category, lat, lng) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(area.id, area.name, area.description, area.category, area.lat, area.lng)
        .run();

    return NextResponse.json({ area: { ...area, thumbnails: [] } }, { status: 201 });
}
