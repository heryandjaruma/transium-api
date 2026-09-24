import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type Params = { params: Promise<{ id: string; badgeId: string }> };

/** Detaches a badge from a quest. */
export async function DELETE(_request: NextRequest, { params }: Params) {
    const { id, badgeId } = await params;
    const { env } = getCloudflareContext();

    const existing = await env.DB.prepare(`SELECT id FROM QuestBadge WHERE questId = ? AND badgeId = ?`).bind(id, badgeId).first();
    if (!existing) return NextResponse.json({ error: "This badge is not attached to this quest" }, { status: 404 });

    await env.DB.prepare(`DELETE FROM QuestBadge WHERE questId = ? AND badgeId = ?`).bind(id, badgeId).run();

    return new NextResponse(null, { status: 204 });
}
