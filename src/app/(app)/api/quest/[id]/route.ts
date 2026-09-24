import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { pruneOrphanedMedia } from "@/lib/media-storage";

type Params = { params: Promise<{ id: string }> };
type QuestRow = { id: string; name: string; category: string; description: string; xp: number; label: string | null };
type MediaRow = { id: string; createdAt: string; type: string; url: string; alt: string | null; copyright: string | null };
type QuestBadgeRow = { id: string; badgeId: string; badgeName: string; badgeCategory: string; badgeType: string; badgeImageUrl: string | null };
type StepRow = {
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
type LatLng = { lat: number; lng: number };

const UPDATABLE_STRING_FIELDS = ["name", "category", "description"] as const;

async function getQuestWithThumbnails(db: D1Database, id: string) {
    const quest = await db.prepare(`SELECT id, name, category, description, xp, label FROM Quest WHERE id = ?`).bind(id).first<QuestRow>();
    if (!quest) return null;

    const media = await db
        .prepare(
            `SELECT m.id as id, m.createdAt as createdAt, m.type as type, m.url as url, m.alt as alt, m.copyright as copyright
             FROM QuestMedia qm JOIN Media m ON m.id = qm.mediaId
             WHERE qm.questId = ?`
        )
        .bind(id)
        .all<MediaRow>();

    return { ...quest, thumbnails: media.results };
}

/**
 * Returns a single quest with its thumbnail media, attached badges, each badge's
 * ordered steps, and the quest's `origin`/`destination` coordinates — the first and
 * last step (across badges, in attachment order) that has a lat/lng set. Either is
 * `null` when fewer than the required steps have coordinates, e.g. to hit
 * `/api/journey/overview?origin=...&destination=...` for a preview of the quest's route.
 */
async function getQuestDetail(db: D1Database, id: string) {
    const base = await getQuestWithThumbnails(db, id);
    if (!base) return null;

    const badgesRes = await db
        .prepare(
            `SELECT qb.id as id, qb.badgeId as badgeId, b.name as badgeName, b.category as badgeCategory,
                    b.type as badgeType, b.imageUrl as badgeImageUrl
             FROM QuestBadge qb
             JOIN Badge b ON b.id = qb.badgeId
             WHERE qb.questId = ?`
        )
        .bind(id)
        .all<QuestBadgeRow>();

    const badgeIds = badgesRes.results.map((b) => b.badgeId);
    const stepsByBadge = new Map<string, StepRow[]>();
    if (badgeIds.length > 0) {
        const placeholders = badgeIds.map(() => "?").join(", ");
        const stepsRes = await db
            .prepare(
                `SELECT ba.id, ba.badgeId, ba.actionId, ba.sequence, ba.lat, ba.lng, ba.instruction, ba.type,
                        ad.name as actionName
                 FROM BadgeAction ba
                 JOIN ActionDefinition ad ON ad.id = ba.actionId
                 WHERE ba.badgeId IN (${placeholders})
                 ORDER BY ba.sequence`
            )
            .bind(...badgeIds)
            .all<StepRow>();

        for (const step of stepsRes.results) {
            if (!stepsByBadge.has(step.badgeId)) stepsByBadge.set(step.badgeId, []);
            stepsByBadge.get(step.badgeId)!.push(step);
        }
    }

    const badges = badgesRes.results.map((badge) => ({ ...badge, steps: stepsByBadge.get(badge.badgeId) ?? [] }));

    const coords: LatLng[] = badges
        .flatMap((badge) => badge.steps)
        .filter((step): step is StepRow & { lat: number; lng: number } => step.lat !== null && step.lng !== null)
        .map((step) => ({ lat: step.lat, lng: step.lng }));

    return {
        ...base,
        badges,
        origin: coords[0] ?? null,
        destination: coords.length > 1 ? coords[coords.length - 1] : null,
    };
}

/** Returns a single quest with its thumbnails, badges (with steps), and origin/destination. */
export async function GET(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const quest = await getQuestDetail(env.DB, id);
    if (!quest) return NextResponse.json({ error: "Quest not found" }, { status: 404 });

    return NextResponse.json({ quest });
}

/** Updates a quest. Body may include any of `{ name, category, description, xp, label }`. `label` accepts a non-empty string or `null` to clear it. */
export async function PATCH(request: NextRequest, { params }: Params) {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }
    const bodyRecord = body as Record<string, unknown>;

    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    for (const key of UPDATABLE_STRING_FIELDS) {
        const value = bodyRecord[key];
        if (value === undefined) continue;
        if (typeof value !== "string" || !value.trim()) {
            return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
        }
        fields.push(`${key} = ?`);
        values.push(value.trim());
    }
    if ("xp" in bodyRecord) {
        const xp = bodyRecord.xp;
        if (!Number.isInteger(xp) || (xp as number) < 0) {
            return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
        }
        fields.push("xp = ?");
        values.push(xp as number);
    }
    if ("label" in bodyRecord) {
        const label = bodyRecord.label;
        if (label !== null && (typeof label !== "string" || !label.trim())) {
            return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
        }
        fields.push("label = ?");
        values.push(typeof label === "string" ? label.trim() : null);
    }

    if (fields.length === 0) {
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const existing = await env.DB.prepare(`SELECT id FROM Quest WHERE id = ?`).bind(id).first();
    if (!existing) return NextResponse.json({ error: "Quest not found" }, { status: 404 });

    await env.DB.prepare(`UPDATE Quest SET ${fields.join(", ")} WHERE id = ?`).bind(...values, id).run();

    return NextResponse.json({ quest: await getQuestDetail(env.DB, id) });
}

/** Deletes a quest, its QuestMedia/QuestBadge links, and any thumbnails no longer used elsewhere. */
export async function DELETE(_request: NextRequest, { params }: Params) {
    const { id } = await params;
    const { env } = getCloudflareContext();

    const existing = await env.DB.prepare(`SELECT id FROM Quest WHERE id = ?`).bind(id).first();
    if (!existing) return NextResponse.json({ error: "Quest not found" }, { status: 404 });

    const links = await env.DB.prepare(`SELECT mediaId FROM QuestMedia WHERE questId = ?`).bind(id).all<{ mediaId: string }>();

    await env.DB.batch([
        env.DB.prepare(`DELETE FROM QuestMedia WHERE questId = ?`).bind(id),
        env.DB.prepare(`DELETE FROM QuestBadge WHERE questId = ?`).bind(id),
        env.DB.prepare(`DELETE FROM Quest WHERE id = ?`).bind(id),
    ]);

    await pruneOrphanedMedia(env.DB, env.TILES_BUCKET, links.results.map((r) => r.mediaId));

    return new NextResponse(null, { status: 204 });
}
