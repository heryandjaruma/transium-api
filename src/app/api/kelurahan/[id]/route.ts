import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type Params = { params: Promise<{ id: string }> };
type KelurahanRow = { id: string; kelurahanName: string; kecamatanName: string };

const UPDATABLE_FIELDS = ["kelurahanName", "kecamatanName"] as const;

/** Returns a single kelurahan. */
export async function GET(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const kelurahan = await env.DB
        .prepare(`SELECT id, kelurahanName, kecamatanName FROM Kelurahan WHERE id = ?`)
        .bind(id)
        .first<KelurahanRow>();
    if (!kelurahan) return NextResponse.json({ error: "Kelurahan not found" }, { status: 404 });

    return NextResponse.json({ kelurahan });
}

/** Updates a kelurahan. Body may include any of `{ kelurahanName, kecamatanName }`. */
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
    const existing = await env.DB.prepare(`SELECT id FROM Kelurahan WHERE id = ?`).bind(id).first();
    if (!existing) return NextResponse.json({ error: "Kelurahan not found" }, { status: 404 });

    await env.DB.prepare(`UPDATE Kelurahan SET ${fields.join(", ")} WHERE id = ?`).bind(...values, id).run();

    const kelurahan = await env.DB
        .prepare(`SELECT id, kelurahanName, kecamatanName FROM Kelurahan WHERE id = ?`)
        .bind(id)
        .first<KelurahanRow>();
    return NextResponse.json({ kelurahan });
}

/** Deletes a kelurahan, clearing it from any badges that referenced it. */
export async function DELETE(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const existing = await env.DB.prepare(`SELECT id FROM Kelurahan WHERE id = ?`).bind(id).first();
    if (!existing) return NextResponse.json({ error: "Kelurahan not found" }, { status: 404 });

    await env.DB.batch([
        env.DB.prepare(`UPDATE Badge SET kelurahanId = NULL WHERE kelurahanId = ?`).bind(id),
        env.DB.prepare(`DELETE FROM Kelurahan WHERE id = ?`).bind(id),
    ]);

    return new NextResponse(null, { status: 204 });
}
