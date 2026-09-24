import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";
import { haversine } from "@/lib/bus-graph";
import { fetchKelurahanThumbnails, fetchQuestThumbnails, MediaAsset } from "@/lib/media-storage";
import { getQuestOrigins, parseLatLng } from "@/lib/quest-origin";

type KelurahanRow = { id: string; kelurahanName: string; kecamatanName: string; description: string | null; category: string | null };
type QuestRow = { id: string; name: string; category: string; description: string; xp: number; label: string | null };

/**
 * Returns each kelurahan that has at least one reachable quest, paired with those
 * quests — the private, authenticated counterpart to GET /kelurahan/quests. Each
 * quest additionally carries `distanceMeters`: the straight-line (haversine) distance
 * from the caller-supplied `origin` query param ("lat,lng") to the quest's own origin
 * coordinate (its first badge step with a lat/lng, in attachment order — the same
 * point QuestDetail.origin uses). `distanceMeters` is `null` when `origin` is
 * missing/invalid, or when the quest has no located step to measure to.
 */
export async function GET(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const origin = parseLatLng(request.nextUrl.searchParams.get("origin"));
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

    const [thumbnailsByQuest, questOrigins, thumbnailsByKelurahan] = await Promise.all([
        fetchQuestThumbnails(env.DB, questIds),
        origin ? getQuestOrigins(env.DB, questIds) : Promise.resolve(new Map()),
        fetchKelurahanThumbnails(env.DB, kelurahanIds),
    ]);

    const groupsByKelurahan = new Map<string, { kelurahan: KelurahanRow & { thumbnails: MediaAsset[] }; quests: (QuestRow & { thumbnails: MediaAsset[]; distanceMeters: number | null })[] }>();
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
        const questOrigin = questOrigins.get(quest.id);
        groupsByKelurahan.get(kelurahanId)!.quests.push({
            ...quest,
            thumbnails: thumbnailsByQuest.get(quest.id) ?? [],
            distanceMeters: origin && questOrigin ? haversine(origin, questOrigin) : null,
        });
    }

    return NextResponse.json({ groups: [...groupsByKelurahan.values()] });
}
