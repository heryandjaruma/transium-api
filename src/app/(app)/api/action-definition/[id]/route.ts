import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type Params = { params: Promise<{ id: string }> };
type ActionDefinitionRow = { id: string; name: string; description: string; type: string };

const UPDATABLE_FIELDS = ["name", "description", "type"] as const;

/** Returns a single action definition. */
export async function GET(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const actionDefinition = await env.DB
        .prepare(`SELECT id, name, description, type FROM ActionDefinition WHERE id = ?`)
        .bind(id)
        .first<ActionDefinitionRow>();
    if (!actionDefinition) return NextResponse.json({ error: "Action definition not found" }, { status: 404 });

    return NextResponse.json({ actionDefinition });
}

/** Updates an action definition. Body may include any of `{ name, description, type }`. */
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
    const existing = await env.DB.prepare(`SELECT id FROM ActionDefinition WHERE id = ?`).bind(id).first();
    if (!existing) return NextResponse.json({ error: "Action definition not found" }, { status: 404 });

    await env.DB.prepare(`UPDATE ActionDefinition SET ${fields.join(", ")} WHERE id = ?`).bind(...values, id).run();

    const actionDefinition = await env.DB
        .prepare(`SELECT id, name, description, type FROM ActionDefinition WHERE id = ?`)
        .bind(id)
        .first<ActionDefinitionRow>();
    return NextResponse.json({ actionDefinition });
}

/** Deletes an action definition. */
export async function DELETE(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const existing = await env.DB.prepare(`SELECT id FROM ActionDefinition WHERE id = ?`).bind(id).first();
    if (!existing) return NextResponse.json({ error: "Action definition not found" }, { status: 404 });

    await env.DB.prepare(`DELETE FROM ActionDefinition WHERE id = ?`).bind(id).run();

    return new NextResponse(null, { status: 204 });
}
