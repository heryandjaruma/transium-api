import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";
import { haversine } from "@/lib/bus-graph";

type Params = { params: Promise<{ id: string }> };

// Fallback for JourneyStep rows created before radiusMeters existed (pre-migration 0011).
// Otherwise every step carries its own radius, set at creation by POST .../go, so the
// client's CLCircularRegion and this check always agree on what counts as "arrived".
const DEFAULT_GEOFENCE_TOLERANCE_METERS = 150;

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
    actionType: string | null;
    lat: number | null;
    lng: number | null;
    radiusMeters: number | null;
    status: string;
};

/**
 * Advances a journey attempt by completing one of its steps. Body: `{ stepId, lat?, lng? }`.
 *
 * A located step (has lat/lng) is proven by geofence: `lat`/`lng` — the device's current
 * position — are required and checked against that step's own location, within its
 * `radiusMeters`, so arrival can't be spoofed by just naming a `stepId`. An unlocated
 * step has nothing to prove against, so `lat`/`lng` aren't required (and are ignored if
 * sent) — passing just its `stepId` is itself the "I did this" attestation, trusted from
 * the client with no server-side verification.
 *
 * The caller may be advanced into a step ahead of `currentStepSequence` (e.g. they
 * walked past an optional photo stop without opening the app). Any `type: "optional"`
 * step skipped over is auto-marked `status: "done"`; any `type: "required"` step skipped
 * over is left `"waiting"` and caps how far `currentStepSequence` moves, since a required
 * step's completion can't be inferred from a later step's trigger alone.
 *
 * Never finishes the attempt itself, even once every step ends up `"done"` — `status`
 * stays `"started"` and the parent UserQuest is untouched. POST .../complete is the only
 * endpoint that actually finalizes an attempt (and awards xp/badges), so the client is
 * expected to call it once it observes every step done here.
 *
 * Idempotent no-op (200, unchanged) when the attempt isn't `status: "started"` or the
 * target step is already `"done"` — both expected from geofence regions re-firing, or a
 * previous call's catch-up having already covered this step.
 */
export async function POST(request: NextRequest, { params }: Params) {
    const { id } = await params;
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const { stepId, lat, lng } = (body ?? {}) as Record<string, unknown>;

    if (typeof stepId !== "string" || !stepId.trim()) {
        return NextResponse.json({ error: "Invalid stepId" }, { status: 400 });
    }

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
        .prepare(`SELECT id, journeyAttemptId, sequence, name, description, type, actionType, lat, lng, radiusMeters, status FROM JourneyStep WHERE journeyAttemptId = ? ORDER BY sequence`)
        .bind(id)
        .all<JourneyStepRow>();
    const steps = stepsRes.results;

    // Journey already ended (or otherwise not active) — nothing left to advance.
    if (journeyAttempt.status !== "started") {
        return NextResponse.json({ journeyAttempt, steps });
    }

    const target = steps.find((step) => step.id === stepId);
    if (!target) return NextResponse.json({ error: "Journey step not found" }, { status: 404 });

    // Already caught up by an earlier call, or a re-firing geofence region — no-op.
    if (target.status === "done") {
        return NextResponse.json({ journeyAttempt, steps });
    }

    // Only a located step needs geofence proof — an unlocated one has nothing to check
    // the submitted position against, so reaching this point with its stepId is itself
    // the completion (see the docstring above).
    if (target.lat != null && target.lng != null) {
        if (typeof lat !== "number" || !Number.isFinite(lat) || typeof lng !== "number" || !Number.isFinite(lng)) {
            return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
        }
        const distance = haversine({ lat: target.lat, lng: target.lng }, { lat, lng });
        const tolerance = target.radiusMeters ?? DEFAULT_GEOFENCE_TOLERANCE_METERS;
        if (distance > tolerance) {
            return NextResponse.json({ error: "Too far from this step's location" }, { status: 400 });
        }
    }

    // Walk every not-yet-done step up to and including the target: the target itself is
    // already proven (geofence check above, or attestation for an unlocated step),
    // optional steps in between are forgiven, and any required step in between blocks
    // currentStepSequence from moving past it.
    const newlyDone: JourneyStepRow[] = [];
    for (const step of steps) {
        if (step.sequence > target.sequence || step.status === "done") continue;
        if (step.id === target.id || step.type.toLowerCase() === "optional") {
            step.status = "done";
            newlyDone.push(step);
        }
    }

    const firstPending = steps.find((step) => step.status !== "done");
    const newCurrentStepSequence = firstPending ? firstPending.sequence - 1 : steps[steps.length - 1].sequence;

    journeyAttempt.currentStepSequence = newCurrentStepSequence;

    // Deliberately doesn't touch `status`/`endedAt` even once every step is done: this
    // endpoint only proves arrival, it never awards anything. POST .../complete is the
    // sole place an attempt (and its parent UserQuest) actually finishes — it's also
    // where xp/badges get awarded and the device's final stats/path get stored, so
    // finishing the attempt here too would make that award logic unreachable (the client
    // would find `status` already "completed" and get a no-op with zero xp/badges).
    const statements = [
        ...newlyDone.map((step) => env.DB.prepare(`UPDATE JourneyStep SET status = 'done' WHERE id = ?`).bind(step.id)),
        env.DB.prepare(`UPDATE JourneyAttempt SET currentStepSequence = ? WHERE id = ?`).bind(newCurrentStepSequence, id),
    ];

    await env.DB.batch(statements);

    return NextResponse.json({ journeyAttempt, steps });
}
