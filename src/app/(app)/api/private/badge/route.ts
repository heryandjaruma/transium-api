import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";
import type { EarnedBadge } from "@/lib/badge";

/**
 * Returns the badges the caller has earned, most recently earned first. Badges are
 * awarded automatically when POST /private/journey/{id}/complete finishes a journey
 * for a quest carrying them (see QuestBadge) — `questId`/`questName` are that quest,
 * or both `null` if the badge predates journeyAttemptId tracking (shouldn't happen in
 * practice, but journeyAttemptId is nullable in the schema).
 */
export async function GET(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { env } = getCloudflareContext();
    const res = await env.DB
        .prepare(
            `SELECT ub.id as id, ub.badgeId as badgeId, b.name as badgeName, b.category as badgeCategory,
                    b.type as badgeType, b.imageUrl as badgeImageUrl, ub.earnedAt as earnedAt,
                    uq.questId as questId, q.name as questName
             FROM UserBadge ub
             JOIN Badge b ON b.id = ub.badgeId
             LEFT JOIN JourneyAttempt ja ON ja.id = ub.journeyAttemptId
             LEFT JOIN UserQuest uq ON uq.id = ja.userQuestId
             LEFT JOIN Quest q ON q.id = uq.questId
             WHERE ub.userId = ?
             ORDER BY ub.earnedAt DESC`
        )
        .bind(session.user.id)
        .all<EarnedBadge>();

    return NextResponse.json({ badges: res.results });
}
