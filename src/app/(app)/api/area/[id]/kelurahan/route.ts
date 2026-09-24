import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { fetchAreaThumbnails, fetchKelurahanThumbnails } from "@/lib/media-storage";

type Params = { params: Promise<{ id: string }> };
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
type KelurahanRow = { id: string; kelurahanName: string; kecamatanName: string; description: string | null; category: string | null };

/** Returns the group of kelurahans belonging to an area, each with its thumbnails. `area` includes its own thumbnails. */
export async function GET(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const areaRow = await env.DB.prepare(`SELECT id, name, description, category, lat, lng, photoUrl, label FROM Area WHERE id = ?`).bind(id).first<AreaRow>();
    if (!areaRow) return NextResponse.json({ error: "Area not found" }, { status: 404 });

    const [areaThumbnails, kelurahansRes] = await Promise.all([
        fetchAreaThumbnails(env.DB, [id]),
        env.DB
            .prepare(`SELECT id, kelurahanName, kecamatanName, description, category FROM Kelurahan WHERE areaId = ?`)
            .bind(id)
            .all<KelurahanRow>(),
    ]);
    const area = { ...areaRow, thumbnails: areaThumbnails.get(id) ?? [] };

    const thumbnailsByKelurahan = await fetchKelurahanThumbnails(env.DB, kelurahansRes.results.map((k) => k.id));
    const kelurahans = kelurahansRes.results.map((kelurahan) => ({ ...kelurahan, thumbnails: thumbnailsByKelurahan.get(kelurahan.id) ?? [] }));

    return NextResponse.json({ area, kelurahans });
}
