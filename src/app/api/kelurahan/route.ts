import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type KelurahanRow = { id: string; kelurahanName: string; kecamatanName: string };

/** Returns all kelurahans. */
export async function GET() {
    const { env } = getCloudflareContext();
    const res = await env.DB.prepare(`SELECT id, kelurahanName, kecamatanName FROM Kelurahan`).all<KelurahanRow>();
    return NextResponse.json({ kelurahans: res.results });
}

/** Creates a kelurahan. Body: `{ kelurahanName, kecamatanName }`. */
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const { kelurahanName, kecamatanName } = (body ?? {}) as Record<string, unknown>;

    if (
        typeof kelurahanName !== "string" || !kelurahanName.trim() ||
        typeof kecamatanName !== "string" || !kecamatanName.trim()
    ) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const id = crypto.randomUUID();
    const kelurahan: KelurahanRow = { id, kelurahanName: kelurahanName.trim(), kecamatanName: kecamatanName.trim() };

    await env.DB.prepare(`INSERT INTO Kelurahan (id, kelurahanName, kecamatanName) VALUES (?, ?, ?)`)
        .bind(kelurahan.id, kelurahan.kelurahanName, kelurahan.kecamatanName)
        .run();

    return NextResponse.json({ kelurahan }, { status: 201 });
}
