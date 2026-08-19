import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type KelurahanRow = { id: string; kelurahanName: string; kecamatanName: string };
type QuestRow = { id: string; name: string; category: string; description: string; xp: number; label: string | null };
type MediaRow = { id: string; createdAt: string; type: string; url: string };

/**
 * Returns each kelurahan that has at least one reachable quest (a quest with a badge
 * scoped to it via Badge.kelurahanId), paired with those quests. Kelurahans with no
 * quests are omitted.
 */
export async function GET() {
    const { env } = getCloudflareContext();

    const questLinksRes = await env.DB
        .prepare(
            `SELECT DISTINCT k.id as kelurahanId, k.kelurahanName as kelurahanName, k.kecamatanName as kecamatanName,
                    q.id as id, q.name as name, q.category as category, q.description as description, q.xp as xp, q.label as label
             FROM Quest q
             JOIN QuestBadge qb ON qb.questId = q.id
             JOIN Badge b ON b.id = qb.badgeId
             JOIN Kelurahan k ON k.id = b.kelurahanId`
        )
        .all<QuestRow & { kelurahanId: string; kelurahanName: string; kecamatanName: string }>();

    const questIds = [...new Set(questLinksRes.results.map((r) => r.id))];
    const thumbnailsByQuest = new Map<string, MediaRow[]>();
    if (questIds.length > 0) {
        const placeholders = questIds.map(() => "?").join(", ");
        const mediaRes = await env.DB
            .prepare(
                `SELECT qm.questId as questId, m.id as id, m.createdAt as createdAt, m.type as type, m.url as url
                 FROM QuestMedia qm JOIN Media m ON m.id = qm.mediaId
                 WHERE qm.questId IN (${placeholders})`
            )
            .bind(...questIds)
            .all<MediaRow & { questId: string }>();

        for (const { questId, ...media } of mediaRes.results) {
            if (!thumbnailsByQuest.has(questId)) thumbnailsByQuest.set(questId, []);
            thumbnailsByQuest.get(questId)!.push(media);
        }
    }

    const groupsByKelurahan = new Map<string, { kelurahan: KelurahanRow; quests: (QuestRow & { thumbnails: MediaRow[] })[] }>();
    for (const { kelurahanId, kelurahanName, kecamatanName, ...quest } of questLinksRes.results) {
        if (!groupsByKelurahan.has(kelurahanId)) {
            groupsByKelurahan.set(kelurahanId, { kelurahan: { id: kelurahanId, kelurahanName, kecamatanName }, quests: [] });
        }
        groupsByKelurahan.get(kelurahanId)!.quests.push({ ...quest, thumbnails: thumbnailsByQuest.get(quest.id) ?? [] });
    }

    return NextResponse.json({ groups: [...groupsByKelurahan.values()] });
}
