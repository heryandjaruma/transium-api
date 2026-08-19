import { getDirections } from "@/lib/apple-maps";
import type { LatLng, WalkSegment } from "@/lib/journey";

/** Gets a walking route between two points from Apple Maps, as a `WalkSegment`. */
export async function walkSegment(
    env: CloudflareEnv,
    from: LatLng & { name: string; stopId?: string },
    to: LatLng & { name: string; stopId?: string }
): Promise<WalkSegment | null> {
    const data = await getDirections(env, from, to, "Walking");
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
