import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { fetchKelurahanThumbnails } from "@/lib/media-storage";

type KelurahanRow = { id: string; kelurahanName: string; kecamatanName: string; description: string | null; category: string | null };

/** Returns all kelurahans, each with its thumbnail media. */
export async function GET() {
    const { env } = getCloudflareContext();
    const res = await env.DB.prepare(`SELECT id, kelurahanName, kecamatanName, description, category FROM Kelurahan`).all<KelurahanRow>();

    const thumbnailsByKelurahan = await fetchKelurahanThumbnails(env.DB, res.results.map((k) => k.id));
    const kelurahans = res.results.map((kelurahan) => ({ ...kelurahan, thumbnails: thumbnailsByKelurahan.get(kelurahan.id) ?? [] }));

    return NextResponse.json({ kelurahans });
}

/**
 * Creates a kelurahan. Body: `{ kelurahanName, kecamatanName, description?, category? }`.
 * `category` is a comma-separated list of the majority destination types here, e.g. "Beach,Mountains".
 */
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const { kelurahanName, kecamatanName, description, category } = (body ?? {}) as Record<string, unknown>;

    if (
        typeof kelurahanName !== "string" || !kelurahanName.trim() ||
        typeof kecamatanName !== "string" || !kecamatanName.trim() ||
        (description !== undefined && description !== null && (typeof description !== "string" || !description.trim())) ||
        (category !== undefined && category !== null && (typeof category !== "string" || !category.trim()))
    ) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const id = crypto.randomUUID();
    const kelurahan: KelurahanRow = {
        id,
        kelurahanName: kelurahanName.trim(),
        kecamatanName: kecamatanName.trim(),
        description: typeof description === "string" ? description.trim() : null,
        category: typeof category === "string" ? category.trim() : null,
    };

    await env.DB
        .prepare(`INSERT INTO Kelurahan (id, kelurahanName, kecamatanName, description, category) VALUES (?, ?, ?, ?, ?)`)
        .bind(kelurahan.id, kelurahan.kelurahanName, kelurahan.kecamatanName, kelurahan.description, kelurahan.category)
        .run();

    return NextResponse.json({ kelurahan: { ...kelurahan, thumbnails: [] } }, { status: 201 });
}
