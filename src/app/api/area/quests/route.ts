import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { fetchAreaThumbnails, fetchQuestThumbnails, MediaAsset } from "@/lib/media-storage";

type AreaRow = {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    lat: number;
    lng: number;
    photoUrl: string | null;
};
type QuestRow = { id: string; name: string; category: string; description: string; xp: number; label: string | null };

/**
 * Returns each area that has at least one reachable quest (a quest with a badge scoped,
 * via Badge.kelurahanId, to a kelurahan that belongs to that area), paired with those
 * quests. Areas with no quests are omitted.
 */
export async function GET() {
    const { env } = getCloudflareContext();

    const questLinksRes = await env.DB
        .prepare(
            `SELECT DISTINCT a.id as areaId, a.name as areaName, a.description as areaDescription,
                    a.category as areaCategory, a.lat as areaLat, a.lng as areaLng, a.photoUrl as areaPhotoUrl,
                    q.id as id, q.name as name, q.category as category, q.description as description, q.xp as xp, q.label as label
             FROM Quest q
             JOIN QuestBadge qb ON qb.questId = q.id
             JOIN Badge b ON b.id = qb.badgeId
             JOIN Kelurahan k ON k.id = b.kelurahanId
             JOIN Area a ON a.id = k.areaId`
        )
        .all<
            QuestRow & {
                areaId: string;
                areaName: string;
                areaDescription: string | null;
                areaCategory: string | null;
                areaLat: number;
                areaLng: number;
                areaPhotoUrl: string | null;
            }
        >();

    const questIds = [...new Set(questLinksRes.results.map((r) => r.id))];
    const areaIds = [...new Set(questLinksRes.results.map((r) => r.areaId))];

    const [thumbnailsByQuest, thumbnailsByArea] = await Promise.all([
        fetchQuestThumbnails(env.DB, questIds),
        fetchAreaThumbnails(env.DB, areaIds),
    ]);

    const groupsByArea = new Map<string, { area: AreaRow & { thumbnails: MediaAsset[] }; quests: (QuestRow & { thumbnails: MediaAsset[] })[] }>();
    for (const { areaId, areaName, areaDescription, areaCategory, areaLat, areaLng, areaPhotoUrl, ...quest } of questLinksRes.results) {
        if (!groupsByArea.has(areaId)) {
            groupsByArea.set(areaId, {
                area: {
                    id: areaId,
                    name: areaName,
                    description: areaDescription,
                    category: areaCategory,
                    lat: areaLat,
                    lng: areaLng,
                    photoUrl: areaPhotoUrl,
                    thumbnails: thumbnailsByArea.get(areaId) ?? [],
                },
                quests: [],
            });
        }
        groupsByArea.get(areaId)!.quests.push({ ...quest, thumbnails: thumbnailsByQuest.get(quest.id) ?? [] });
    }

    return NextResponse.json({ groups: [...groupsByArea.values()] });
}
