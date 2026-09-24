import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type ActionDefinitionRow = { id: string; name: string; description: string; type: string };

/** Returns all action definitions. */
export async function GET() {
    const { env } = getCloudflareContext();
    const res = await env.DB.prepare(`SELECT id, name, description, type FROM ActionDefinition`).all<ActionDefinitionRow>();
    return NextResponse.json({ actionDefinitions: res.results });
}

/** Creates an action definition. Body: `{ name, description, type }`. */
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const { name, description, type } = (body ?? {}) as Record<string, unknown>;

    if (
        typeof name !== "string" || !name.trim() ||
        typeof description !== "string" || !description.trim() ||
        typeof type !== "string" || !type.trim()
    ) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const id = crypto.randomUUID();
    const actionDefinition: ActionDefinitionRow = {
        id,
        name: name.trim(),
        description: description.trim(),
        type: type.trim(),
    };

    await env.DB.prepare(`INSERT INTO ActionDefinition (id, name, description, type) VALUES (?, ?, ?, ?)`)
        .bind(actionDefinition.id, actionDefinition.name, actionDefinition.description, actionDefinition.type)
        .run();

    return NextResponse.json({ actionDefinition }, { status: 201 });
}
