import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { fetchAreaThumbnails } from "@/lib/media-storage";

type AreaRow = {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    lat: number;
    lng: number;
    photoUrl: string | null;
    label: string | null;
};

/** Returns all areas, each with its thumbnail media. Query: `label?` — filters to areas with that exact label (e.g. "Recommended"). */
export async function GET(request: NextRequest) {
    const label = request.nextUrl.searchParams.get("label");
    const { env } = getCloudflareContext();

    const query = `SELECT id, name, description, category, lat, lng, photoUrl, label FROM Area${label ? " WHERE label = ?" : ""}`;
    const stmt = label ? env.DB.prepare(query).bind(label) : env.DB.prepare(query);
    const res = await stmt.all<AreaRow>();

    const thumbnailsByArea = await fetchAreaThumbnails(env.DB, res.results.map((a) => a.id));
    const areas = res.results.map((area) => ({ ...area, thumbnails: thumbnailsByArea.get(area.id) ?? [] }));

    return NextResponse.json({ areas });
}

/**
 * Creates an area. Body: `{ name, lat, lng, description?, category?, label? }`.
 * `lat`/`lng` are the area's center point, used to estimate distance to it later.
 * `category` is a comma-separated list of the majority destination types here, e.g. "Beach,Mountains".
 * `label` is a highlight tag, e.g. "Recommended".
 * Use /api/area/photo to set the hero `photoUrl` afterward.
 */
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const { name, lat, lng, description, category, label } = (body ?? {}) as Record<string, unknown>;

    if (
        typeof name !== "string" || !name.trim() ||
        typeof lat !== "number" || !Number.isFinite(lat) ||
        typeof lng !== "number" || !Number.isFinite(lng) ||
        (description !== undefined && description !== null && (typeof description !== "string" || !description.trim())) ||
        (category !== undefined && category !== null && (typeof category !== "string" || !category.trim())) ||
        (label !== undefined && label !== null && (typeof label !== "string" || !label.trim()))
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
        photoUrl: null,
        label: typeof label === "string" ? label.trim() : null,
    };

    await env.DB
        .prepare(`INSERT INTO Area (id, name, description, category, lat, lng, label) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(area.id, area.name, area.description, area.category, area.lat, area.lng, area.label)
        .run();

    return NextResponse.json({ area: { ...area, thumbnails: [] } }, { status: 201 });
}
