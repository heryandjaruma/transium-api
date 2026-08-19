import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

type JourneyAttemptRow = {
    id: string;
    userQuestId: string;
    questId: string;
    questName: string;
    questCategory: string;
    currentStepSequence: number;
    status: string;
    createdAt: string;
    startedAt: string | null;
    endedAt: string | null;
};

type JourneyStepRow = {
    id: string;
    journeyAttemptId: string;
    sequence: number;
    name: string;
    description: string;
    type: string;
    lat: number | null;
    lng: number | null;
    status: string;
};

type JourneySummaryRow = {
    id: string;
    journeyAttemptId: string;
    stepsTaken: number;
    distanceMeters: number;
    calorie: number;
    startPoint: string;
    finishPoint: string;
};

type JourneyPathPointRow = {
    id: string;
    journeyAttemptId: string;
    sequence: number;
    lat: number;
    lng: number;
    recordedAt: string | null;
};

type PathPointInput = { lat: number; lng: number; recordedAt: string | null };

/**
 * Validates the complete-journey body: the summary stats (stepsTaken/distanceMeters/
 * calorie come from the device — HealthKit-derived, nothing the server can compute) and
 * the walked path, an ordered breadcrumb of GPS points for drawing the finished journey
 * (Strava-style), kept separate from JourneySummary since it's a point series, not a
 * scalar.
 */
function parseCompleteBody(body: unknown) {
    const { stepsTaken, distanceMeters, calorie, startPoint, finishPoint, path } = (body ?? {}) as Record<string, unknown>;

    if (typeof stepsTaken !== "number" || !Number.isFinite(stepsTaken) || stepsTaken < 0) {
        return { error: "Invalid stepsTaken" } as const;
    }
    if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
        return { error: "Invalid distanceMeters" } as const;
    }
    if (typeof calorie !== "number" || !Number.isFinite(calorie) || calorie < 0) {
        return { error: "Invalid calorie" } as const;
    }
    if (typeof startPoint !== "string" || !startPoint.trim()) {
        return { error: "Invalid startPoint" } as const;
    }
    if (typeof finishPoint !== "string" || !finishPoint.trim()) {
        return { error: "Invalid finishPoint" } as const;
    }
    if (!Array.isArray(path)) {
        return { error: "Invalid path" } as const;
    }

    const points: PathPointInput[] = [];
    for (const point of path) {
        const { lat, lng, recordedAt } = (point ?? {}) as Record<string, unknown>;
        if (typeof lat !== "number" || !Number.isFinite(lat) || typeof lng !== "number" || !Number.isFinite(lng)) {
            return { error: "Invalid path point" } as const;
        }
        if (recordedAt !== undefined && recordedAt !== null && typeof recordedAt !== "string") {
            return { error: "Invalid path point" } as const;
        }
        points.push({ lat, lng, recordedAt: typeof recordedAt === "string" ? recordedAt : null });
    }

    return {
        stepsTaken,
        distanceMeters,
        calorie,
        startPoint: startPoint.trim(),
        finishPoint: finishPoint.trim(),
        path: points,
    } as const;
}

/**
 * Explicitly completes a journey attempt. Unlike POST .../advance, this endpoint never
 * marks steps done itself — it only finalizes an attempt whose JourneySteps are already
 * all `status: "done"` (via advance, or any other completion path), guarding against
 * finishing early. Body: `{ stepsTaken, distanceMeters, calorie, startPoint, finishPoint,
 * path }` — `path` is the device's recorded breadcrumb (`[{ lat, lng, recordedAt? }]`)
 * for the walked route, stored separately from the summary.
 *
 * Marks the JourneyAttempt `status: "completed"` with `endedAt`, the parent UserQuest
 * `status: "completed"`, and writes JourneySummary + JourneyPathPoint rows.
 *
 * Idempotent no-op (200, returning the existing summary/path unchanged) if the attempt
 * is already `status: "completed"`. Fails with 400 if any step is still `"waiting"` (the
 * body isn't even parsed in that case), or 409 if the attempt isn't active.
 */
export async function POST(request: NextRequest, { params }: Params) {
    const { id } = await params;
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { env } = getCloudflareContext();

    const journeyAttempt = await env.DB
        .prepare(
            `SELECT ja.id, ja.userQuestId, uq.questId, q.name as questName, q.category as questCategory,
                    ja.currentStepSequence, ja.status, ja.createdAt, ja.startedAt, ja.endedAt
             FROM JourneyAttempt ja
             JOIN UserQuest uq ON uq.id = ja.userQuestId
             JOIN Quest q ON q.id = uq.questId
             WHERE ja.id = ? AND uq.userId = ?`
        )
        .bind(id, session.user.id)
        .first<JourneyAttemptRow>();
    if (!journeyAttempt) return NextResponse.json({ error: "Journey not found" }, { status: 404 });

    const stepsRes = await env.DB
        .prepare(`SELECT id, journeyAttemptId, sequence, name, description, type, lat, lng, status FROM JourneyStep WHERE journeyAttemptId = ? ORDER BY sequence`)
        .bind(id)
        .all<JourneyStepRow>();
    const steps = stepsRes.results;

    // Already finished — nothing to do.
    if (journeyAttempt.status === "completed") {
        const summary = await env.DB
            .prepare(`SELECT id, journeyAttemptId, stepsTaken, distanceMeters, calorie, startPoint, finishPoint FROM JourneySummary WHERE journeyAttemptId = ?`)
            .bind(id)
            .first<JourneySummaryRow>();
        const pathRes = await env.DB
            .prepare(`SELECT id, journeyAttemptId, sequence, lat, lng, recordedAt FROM JourneyPathPoint WHERE journeyAttemptId = ? ORDER BY sequence`)
            .bind(id)
            .all<JourneyPathPointRow>();
        return NextResponse.json({ journeyAttempt, steps, summary: summary ?? null, path: pathRes.results });
    }
    if (journeyAttempt.status !== "started") {
        return NextResponse.json({ error: "Journey is not active" }, { status: 409 });
    }

    const pending = steps.filter((step) => step.status !== "done");
    if (pending.length > 0) {
        return NextResponse.json(
            { error: "Every step must be done before completing this journey", pendingStepIds: pending.map((step) => step.id) },
            { status: 400 }
        );
    }

    const parsed = parseCompleteBody(await request.json().catch(() => null));
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const now = new Date().toISOString();
    journeyAttempt.status = "completed";
    journeyAttempt.endedAt = now;
    journeyAttempt.currentStepSequence = steps[steps.length - 1].sequence;

    const summary: JourneySummaryRow = {
        id: crypto.randomUUID(),
        journeyAttemptId: id,
        stepsTaken: parsed.stepsTaken,
        distanceMeters: parsed.distanceMeters,
        calorie: parsed.calorie,
        startPoint: parsed.startPoint,
        finishPoint: parsed.finishPoint,
    };

    const path: JourneyPathPointRow[] = parsed.path.map((point, index) => ({
        id: crypto.randomUUID(),
        journeyAttemptId: id,
        sequence: index + 1,
        lat: point.lat,
        lng: point.lng,
        recordedAt: point.recordedAt,
    }));

    await env.DB.batch([
        env.DB
            .prepare(`UPDATE JourneyAttempt SET status = 'completed', endedAt = ?, currentStepSequence = ? WHERE id = ?`)
            .bind(now, journeyAttempt.currentStepSequence, id),
        env.DB
            .prepare(`UPDATE UserQuest SET status = 'completed', completedAt = ? WHERE id = ? AND status != 'completed'`)
            .bind(now, journeyAttempt.userQuestId),
        env.DB
            .prepare(
                `INSERT INTO JourneySummary (id, journeyAttemptId, stepsTaken, distanceMeters, calorie, startPoint, finishPoint)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(summary.id, summary.journeyAttemptId, summary.stepsTaken, summary.distanceMeters, summary.calorie, summary.startPoint, summary.finishPoint),
        ...path.map((point) =>
            env.DB
                .prepare(`INSERT INTO JourneyPathPoint (id, journeyAttemptId, sequence, lat, lng, recordedAt) VALUES (?, ?, ?, ?, ?, ?)`)
                .bind(point.id, point.journeyAttemptId, point.sequence, point.lat, point.lng, point.recordedAt)
        ),
    ]);

    return NextResponse.json({ journeyAttempt, steps, summary, path });
}
