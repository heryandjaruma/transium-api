import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type Params = { params: Promise<{ id: string }> };
type KelurahanRow = { id: string; kelurahanName: string; kecamatanName: string };
type QuestRow = { id: string; name: string; category: string; description: string; xp: number };
type MediaRow = { id: string; createdAt: string; type: string; url: string };
type QuestBadgeRow = {
    id: string;
    questId: string;
    badgeId: string;
    badgeName: string;
    badgeCategory: string;
    badgeType: string;
    badgeImageUrl: string | null;
};

/**
 * Returns the quests available in a kelurahan (quests with at least one badge scoped
 * to it via Badge.kelurahanId), each with its thumbnails and all of its attached badges.
 */
export async function GET(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const kelurahan = await env.DB
        .prepare(`SELECT id, kelurahanName, kecamatanName FROM Kelurahan WHERE id = ?`)
        .bind(id)
        .first<KelurahanRow>();
    if (!kelurahan) return NextResponse.json({ error: "Kelurahan not found" }, { status: 404 });

    const questsRes = await env.DB
        .prepare(
            `SELECT DISTINCT q.id as id, q.name as name, q.category as category, q.description as description, q.xp as xp
             FROM Quest q
             JOIN QuestBadge qb ON qb.questId = q.id
             JOIN Badge b ON b.id = qb.badgeId
             WHERE b.kelurahanId = ?`
        )
        .bind(id)
        .all<QuestRow>();

    const quests = questsRes.results;
    if (quests.length === 0) return NextResponse.json({ kelurahan, quests: [] });

    const placeholders = quests.map(() => "?").join(", ");
    const questIds = quests.map((q) => q.id);

    const [mediaRes, badgesRes] = await Promise.all([
        env.DB
            .prepare(
                `SELECT qm.questId as questId, m.id as id, m.createdAt as createdAt, m.type as type, m.url as url
                 FROM QuestMedia qm JOIN Media m ON m.id = qm.mediaId
                 WHERE qm.questId IN (${placeholders})`
            )
            .bind(...questIds)
            .all<MediaRow & { questId: string }>(),
        env.DB
            .prepare(
                `SELECT qb.id as id, qb.questId as questId, qb.badgeId as badgeId, b.name as badgeName,
                        b.category as badgeCategory, b.type as badgeType, b.imageUrl as badgeImageUrl
                 FROM QuestBadge qb
                 JOIN Badge b ON b.id = qb.badgeId
                 WHERE qb.questId IN (${placeholders})`
            )
            .bind(...questIds)
            .all<QuestBadgeRow>(),
    ]);

    const thumbnailsByQuest = new Map<string, MediaRow[]>();
    for (const { questId, ...media } of mediaRes.results) {
        if (!thumbnailsByQuest.has(questId)) thumbnailsByQuest.set(questId, []);
        thumbnailsByQuest.get(questId)!.push(media);
    }

    const badgesByQuest = new Map<string, QuestBadgeRow[]>();
    for (const badge of badgesRes.results) {
        if (!badgesByQuest.has(badge.questId)) badgesByQuest.set(badge.questId, []);
        badgesByQuest.get(badge.questId)!.push(badge);
    }

    return NextResponse.json({
        kelurahan,
        quests: quests.map((quest) => ({
            ...quest,
            thumbnails: thumbnailsByQuest.get(quest.id) ?? [],
            badges: badgesByQuest.get(quest.id) ?? [],
        })),
    });
}
