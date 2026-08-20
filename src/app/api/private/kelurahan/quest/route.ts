import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";
import { haversine } from "@/lib/bus-graph";
import { getQuestOrigins, parseLatLng } from "@/lib/quest-origin";

type KelurahanRow = { id: string; kelurahanName: string; kecamatanName: string };
type QuestRow = { id: string; name: string; category: string; description: string; xp: number; label: string | null };
type MediaRow = { id: string; createdAt: string; type: string; url: string };

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
                    q.id as id, q.name as name, q.category as category, q.description as description, q.xp as xp, q.label as label
             FROM Quest q
             JOIN QuestBadge qb ON qb.questId = q.id
             JOIN Badge b ON b.id = qb.badgeId
             JOIN Kelurahan k ON k.id = b.kelurahanId`
        )
        .all<QuestRow & { kelurahanId: string; kelurahanName: string; kecamatanName: string }>();

    const questIds = [...new Set(questLinksRes.results.map((r) => r.id))];

    const [mediaRes, questOrigins] = await Promise.all([
        questIds.length > 0
            ? env.DB
                  .prepare(
                      `SELECT qm.questId as questId, m.id as id, m.createdAt as createdAt, m.type as type, m.url as url
                       FROM QuestMedia qm JOIN Media m ON m.id = qm.mediaId
                       WHERE qm.questId IN (${questIds.map(() => "?").join(", ")})`
                  )
                  .bind(...questIds)
                  .all<MediaRow & { questId: string }>()
            : Promise.resolve({ results: [] as (MediaRow & { questId: string })[] }),
        origin ? getQuestOrigins(env.DB, questIds) : Promise.resolve(new Map()),
    ]);

    const thumbnailsByQuest = new Map<string, MediaRow[]>();
    for (const { questId, ...media } of mediaRes.results) {
        if (!thumbnailsByQuest.has(questId)) thumbnailsByQuest.set(questId, []);
        thumbnailsByQuest.get(questId)!.push(media);
    }

    const groupsByKelurahan = new Map<string, { kelurahan: KelurahanRow; quests: (QuestRow & { thumbnails: MediaRow[]; distanceMeters: number | null })[] }>();
    for (const { kelurahanId, kelurahanName, kecamatanName, ...quest } of questLinksRes.results) {
        if (!groupsByKelurahan.has(kelurahanId)) {
            groupsByKelurahan.set(kelurahanId, { kelurahan: { id: kelurahanId, kelurahanName, kecamatanName }, quests: [] });
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
