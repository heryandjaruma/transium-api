import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type Params = { params: Promise<{ id: string }> };
type QuestBadgeRow = {
    id: string;
    questId: string;
    badgeId: string;
    badgeName: string;
    badgeCategory: string;
    badgeType: string;
    badgeImageUrl: string | null;
};

const SELECT_QUEST_BADGE = `
    SELECT qb.id, qb.questId, qb.badgeId, b.name as badgeName, b.category as badgeCategory,
           b.type as badgeType, b.imageUrl as badgeImageUrl
    FROM QuestBadge qb
    JOIN Badge b ON b.id = qb.badgeId
`;

/** Returns the badges attached to a quest. */
export async function GET(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const quest = await env.DB.prepare(`SELECT id FROM Quest WHERE id = ?`).bind(id).first();
    if (!quest) return NextResponse.json({ error: "Quest not found" }, { status: 404 });

    const res = await env.DB.prepare(`${SELECT_QUEST_BADGE} WHERE qb.questId = ?`).bind(id).all<QuestBadgeRow>();
    return NextResponse.json({ questBadges: res.results });
}

/** Attaches a badge to a quest. Body: `{ badgeId }`. */
export async function POST(request: NextRequest, { params }: Params) {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const { badgeId } = (body ?? {}) as Record<string, unknown>;

    if (typeof badgeId !== "string" || !badgeId.trim()) {
        return NextResponse.json({ error: "Invalid badgeId" }, { status: 400 });
    }

    const { env } = getCloudflareContext();

    const quest = await env.DB.prepare(`SELECT id FROM Quest WHERE id = ?`).bind(id).first();
    if (!quest) return NextResponse.json({ error: "Quest not found" }, { status: 404 });

    const badge = await env.DB.prepare(`SELECT id FROM Badge WHERE id = ?`).bind(badgeId).first();
    if (!badge) return NextResponse.json({ error: "Badge not found" }, { status: 404 });

    const duplicate = await env.DB.prepare(`SELECT id FROM QuestBadge WHERE questId = ? AND badgeId = ?`).bind(id, badgeId).first();
    if (duplicate) return NextResponse.json({ error: "This badge is already attached to this quest" }, { status: 409 });

    const linkId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO QuestBadge (id, questId, badgeId) VALUES (?, ?, ?)`).bind(linkId, id, badgeId).run();

    const questBadge = await env.DB.prepare(`${SELECT_QUEST_BADGE} WHERE qb.id = ?`).bind(linkId).first<QuestBadgeRow>();
    return NextResponse.json({ questBadge }, { status: 201 });
}
