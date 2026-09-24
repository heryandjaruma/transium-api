import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type Params = { params: Promise<{ id: string; stepId: string }> };
type BadgeActionStepRow = {
    id: string;
    badgeId: string;
    actionId: string;
    actionName: string;
    type: string;
    sequence: number;
    lat: number | null;
    lng: number | null;
    instruction: string | null;
};
type StepPatch = { actionId?: string; sequence?: number; type?: string; lat?: number | null; lng?: number | null; instruction?: string | null };

const SELECT_STEP = `
    SELECT ba.id, ba.badgeId, ba.actionId, ba.sequence, ba.lat, ba.lng, ba.instruction, ba.type,
           ad.name as actionName
    FROM BadgeAction ba
    JOIN ActionDefinition ad ON ad.id = ba.actionId
`;

function parseStepPatchBody(body: unknown) {
    if (!body || typeof body !== "object") return { error: "Invalid arguments" } as const;
    const { actionId, sequence, type, lat, lng, instruction } = body as Record<string, unknown>;

    const patch: StepPatch = {};

    if (actionId !== undefined) {
        if (typeof actionId !== "string" || !actionId.trim()) return { error: "Invalid actionId" } as const;
        patch.actionId = actionId.trim();
    }
    if (sequence !== undefined) {
        if (typeof sequence !== "number" || !Number.isFinite(sequence)) return { error: "Invalid sequence" } as const;
        patch.sequence = sequence;
    }
    if (type !== undefined) {
        if (type !== "required" && type !== "optional") return { error: "Invalid type" } as const;
        patch.type = type;
    }
    if (lat !== undefined) {
        if (lat !== null && typeof lat !== "number") return { error: "Invalid lat" } as const;
        patch.lat = lat;
    }
    if (lng !== undefined) {
        if (lng !== null && typeof lng !== "number") return { error: "Invalid lng" } as const;
        patch.lng = lng;
    }
    if (instruction !== undefined) {
        if (instruction !== null && typeof instruction !== "string") return { error: "Invalid instruction" } as const;
        patch.instruction = typeof instruction === "string" && instruction.trim() ? instruction.trim() : null;
    }

    return patch;
}

/** Updates a badge step. Body may include any of `{ actionId, sequence, type, lat, lng, instruction }` — `type` is `"required"` or `"optional"`. */
export async function PATCH(request: NextRequest, { params }: Params) {
    const { id, stepId } = await params;
    const body = await request.json().catch(() => null);
    const patch = parseStepPatchBody(body);
    if ("error" in patch) return NextResponse.json({ error: patch.error }, { status: 400 });

    const { env } = getCloudflareContext();
    const existing = await env.DB.prepare(`SELECT id FROM BadgeAction WHERE id = ? AND badgeId = ?`).bind(stepId, id).first();
    if (!existing) return NextResponse.json({ error: "Step not found" }, { status: 404 });

    if (patch.actionId) {
        const action = await env.DB.prepare(`SELECT id FROM ActionDefinition WHERE id = ?`).bind(patch.actionId).first();
        if (!action) return NextResponse.json({ error: "Action definition not found" }, { status: 404 });

        const duplicate = await env.DB
            .prepare(`SELECT id FROM BadgeAction WHERE badgeId = ? AND actionId = ? AND id != ?`)
            .bind(id, patch.actionId, stepId)
            .first();
        if (duplicate) return NextResponse.json({ error: "This action is already a step for this badge" }, { status: 409 });
    }

    const fields = Object.keys(patch) as (keyof StepPatch)[];
    if (fields.length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });

    const setClause = fields.map((key) => `${key} = ?`).join(", ");
    const values = fields.map((key) => patch[key]);

    await env.DB.prepare(`UPDATE BadgeAction SET ${setClause} WHERE id = ?`).bind(...values, stepId).run();

    const step = await env.DB.prepare(`${SELECT_STEP} WHERE ba.id = ?`).bind(stepId).first<BadgeActionStepRow>();
    return NextResponse.json({ step });
}

/** Removes a badge step. */
export async function DELETE(_request: NextRequest, { params }: Params) {
    const { id, stepId } = await params;
    const { env } = getCloudflareContext();

    const existing = await env.DB.prepare(`SELECT id FROM BadgeAction WHERE id = ? AND badgeId = ?`).bind(stepId, id).first();
    if (!existing) return NextResponse.json({ error: "Step not found" }, { status: 404 });

    await env.DB.prepare(`DELETE FROM BadgeAction WHERE id = ?`).bind(stepId).run();

    return new NextResponse(null, { status: 204 });
}
