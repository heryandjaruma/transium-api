import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type Params = { params: Promise<{ id: string }> };
type BadgeActionStepRow = {
    id: string;
    badgeId: string;
    actionId: string;
    actionName: string;
    actionType: string;
    sequence: number;
    lat: number | null;
    lng: number | null;
    instruction: string | null;
};

const SELECT_STEP = `
    SELECT ba.id, ba.badgeId, ba.actionId, ba.sequence, ba.lat, ba.lng, ba.instruction,
           ad.name as actionName, ad.type as actionType
    FROM BadgeAction ba
    JOIN ActionDefinition ad ON ad.id = ba.actionId
`;

function parseStepBody(body: unknown) {
    const { actionId, sequence, lat, lng, instruction } = (body ?? {}) as Record<string, unknown>;

    if (typeof actionId !== "string" || !actionId.trim()) return { error: "Invalid actionId" } as const;
    if (typeof sequence !== "number" || !Number.isFinite(sequence)) return { error: "Invalid sequence" } as const;
    if (lat !== null && lat !== undefined && typeof lat !== "number") return { error: "Invalid lat" } as const;
    if (lng !== null && lng !== undefined && typeof lng !== "number") return { error: "Invalid lng" } as const;
    if (instruction !== null && instruction !== undefined && typeof instruction !== "string") {
        return { error: "Invalid instruction" } as const;
    }

    return {
        actionId: actionId.trim(),
        sequence,
        lat: typeof lat === "number" ? lat : null,
        lng: typeof lng === "number" ? lng : null,
        instruction: typeof instruction === "string" && instruction.trim() ? instruction.trim() : null,
    } as const;
}

/** Returns the ordered steps (BadgeAction rows) for a badge. */
export async function GET(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const badge = await env.DB.prepare(`SELECT id FROM Badge WHERE id = ?`).bind(id).first();
    if (!badge) return NextResponse.json({ error: "Badge not found" }, { status: 404 });

    const res = await env.DB.prepare(`${SELECT_STEP} WHERE ba.badgeId = ? ORDER BY ba.sequence`).bind(id).all<BadgeActionStepRow>();
    return NextResponse.json({ steps: res.results });
}

/** Adds a step to a badge. Body: `{ actionId, sequence, lat?, lng?, instruction? }`. */
export async function POST(request: NextRequest, { params }: Params) {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = parseStepBody(body);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { env } = getCloudflareContext();

    const badge = await env.DB.prepare(`SELECT id FROM Badge WHERE id = ?`).bind(id).first();
    if (!badge) return NextResponse.json({ error: "Badge not found" }, { status: 404 });

    const action = await env.DB.prepare(`SELECT id FROM ActionDefinition WHERE id = ?`).bind(parsed.actionId).first();
    if (!action) return NextResponse.json({ error: "Action definition not found" }, { status: 404 });

    const duplicate = await env.DB
        .prepare(`SELECT id FROM BadgeAction WHERE badgeId = ? AND actionId = ?`)
        .bind(id, parsed.actionId)
        .first();
    if (duplicate) return NextResponse.json({ error: "This action is already a step for this badge" }, { status: 409 });

    const stepId = crypto.randomUUID();
    await env.DB
        .prepare(`INSERT INTO BadgeAction (id, badgeId, actionId, sequence, lat, lng, instruction) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(stepId, id, parsed.actionId, parsed.sequence, parsed.lat, parsed.lng, parsed.instruction)
        .run();

    const step = await env.DB.prepare(`${SELECT_STEP} WHERE ba.id = ?`).bind(stepId).first<BadgeActionStepRow>();
    return NextResponse.json({ step }, { status: 201 });
}
