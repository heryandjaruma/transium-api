import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { fetchKelurahanThumbnails, fetchQuestThumbnails, MediaAsset } from "@/lib/media-storage";

type KelurahanRow = { id: string; kelurahanName: string; kecamatanName: string; description: string | null; category: string | null };
type QuestRow = { id: string; name: string; category: string; description: string; xp: number; label: string | null };

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
                    k.description as kelurahanDescription, k.category as kelurahanCategory,
                    q.id as id, q.name as name, q.category as category, q.description as description, q.xp as xp, q.label as label
             FROM Quest q
             JOIN QuestBadge qb ON qb.questId = q.id
             JOIN Badge b ON b.id = qb.badgeId
             JOIN Kelurahan k ON k.id = b.kelurahanId`
        )
        .all<QuestRow & { kelurahanId: string; kelurahanName: string; kecamatanName: string; kelurahanDescription: string | null; kelurahanCategory: string | null }>();

    const questIds = [...new Set(questLinksRes.results.map((r) => r.id))];
    const kelurahanIds = [...new Set(questLinksRes.results.map((r) => r.kelurahanId))];

    const [thumbnailsByQuest, thumbnailsByKelurahan] = await Promise.all([
        fetchQuestThumbnails(env.DB, questIds),
        fetchKelurahanThumbnails(env.DB, kelurahanIds),
    ]);

    const groupsByKelurahan = new Map<string, { kelurahan: KelurahanRow & { thumbnails: MediaAsset[] }; quests: (QuestRow & { thumbnails: MediaAsset[] })[] }>();
    for (const { kelurahanId, kelurahanName, kecamatanName, kelurahanDescription, kelurahanCategory, ...quest } of questLinksRes.results) {
        if (!groupsByKelurahan.has(kelurahanId)) {
            groupsByKelurahan.set(kelurahanId, {
                kelurahan: {
                    id: kelurahanId,
                    kelurahanName,
                    kecamatanName,
                    description: kelurahanDescription,
                    category: kelurahanCategory,
                    thumbnails: thumbnailsByKelurahan.get(kelurahanId) ?? [],
                },
                quests: [],
            });
        }
        groupsByKelurahan.get(kelurahanId)!.quests.push({ ...quest, thumbnails: thumbnailsByQuest.get(quest.id) ?? [] });
    }

    return NextResponse.json({ groups: [...groupsByKelurahan.values()] });
}
