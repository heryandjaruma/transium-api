import { getDirections, MapsLang } from "@/lib/apple-maps";
import type { JourneySegment, JourneyStep, JourneySummary, LatLng, WalkSegment } from "@/lib/journey";

/** Gets a walking route between two points from Apple Maps, as a `WalkSegment`. */
export async function walkSegment(
    env: CloudflareEnv,
    from: LatLng & { name: string; stopId?: string },
    to: LatLng & { name: string; stopId?: string },
    lang?: MapsLang
): Promise<WalkSegment | null> {
    const data = await getDirections(env, from, to, "Walking", lang);
    const route = data.routes?.[0];
    if (!route) return null;

    const geometry: [number, number][] = [];
    const steps = (route.stepIndexes ?? []).map((i) => {
        const step = data.steps![i];
        const path = (data.stepPaths?.[step.stepPathIndex!] ?? []).map(
            (loc): [number, number] => [loc.longitude, loc.latitude]
        );
        // Step paths share their boundary point with the next step's path, per Apple's docs.
        geometry.push(...(geometry.length ? path.slice(1) : path));
        return {
            instructions: step.instructions,
            distanceMeters: step.distanceMeters,
            durationSeconds: step.durationSeconds,
            geometry: path,
        };
    });

    return {
        type: "walk" as const,
        from,
        to,
        distanceMeters: route.distanceMeters ?? null,
        durationSeconds: route.durationSeconds ?? null,
        geometry,
        steps,
    };
}

/** Totals a journey's segments into the summary shape /api/journey/overview and /api/journey/real return. */
export function summarizeSegments(segments: JourneySegment[]): JourneySummary {
    let walkingDistanceMeters = 0;
    let walkingDurationSeconds = 0;
    let transitDistanceMeters = 0;
    let busLegCount = 0;
    let transferCount = 0;

    for (const seg of segments) {
        if (seg.type === "walk") {
            walkingDistanceMeters += seg.distanceMeters ?? 0;
            walkingDurationSeconds += seg.durationSeconds ?? 0;
        } else if (seg.type === "bus") {
            transitDistanceMeters += seg.distanceMeters ?? 0;
            busLegCount++;
        } else if (seg.type === "transfer") {
            transitDistanceMeters += seg.distanceMeters ?? 0;
            transferCount++;
        }
        // "mission" segments aren't travel — nothing to total.
    }

    return {
        distanceMeters: walkingDistanceMeters + transitDistanceMeters,
        walkingDistanceMeters,
        walkingDurationSeconds,
        transitDistanceMeters,
        busLegCount,
        transferCount,
    };
}

/**
 * Collapses journey segments into a brief outline — e.g. "Walk 5 min", "K5B", "Walk 3
 * min" — merging adjacent walk/transfer segments (both are walking to the rider) so a
 * boarding-stop transfer right after a walk, or a quest's own walking legs tacked onto
 * a transit leg's final walk, doesn't show as separate walk steps. A `mission` segment
 * becomes its own sign-post entry instead — it's not travel, so it's never merged, and
 * it also breaks the walk-merging run (a walk right before and right after a mission
 * stay two separate steps, since the mission happens between them).
 */
export function stepsFromSegments(segments: JourneySegment[]): JourneyStep[] {
    const steps: JourneyStep[] = [];
    for (const seg of segments) {
        if (seg.type === "mission") {
            steps.push(
                seg.lat != null && seg.lng != null
                    ? { type: "mission", instructions: seg.instructions, lat: seg.lat, lng: seg.lng }
                    : { type: "mission", instructions: seg.instructions }
            );
            continue;
        }

        if (seg.type === "bus") {
            steps.push({
                type: "ride",
                routeRef: seg.routeRef ?? seg.routeId,
                routeName: seg.routeName,
                durationMinutes: Math.round((seg.durationSeconds ?? 0) / 60),
            });
            continue;
        }

        const durationMinutes = Math.round((seg.durationSeconds ?? 0) / 60);
        const last = steps[steps.length - 1];
        if (last?.type === "walk") {
            last.durationMinutes += durationMinutes;
        } else {
            steps.push({ type: "walk", durationMinutes });
        }
    }
    return steps;
}
