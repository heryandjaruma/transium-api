import { CostWeights } from "./astar";
import { JourneyStep } from "./journey";

// Two routing profiles built from the shared cost model (see astar.ts):
//   cost = in_vehicle_time + walkTimeWeight*walking_time + waitTimeWeight*waiting_time + transferPenalty*num_transfers
// `lessWalking` prices walking heavily so the search leans on transit instead of foot
// legs. `lessTransit` prices each transfer heavily (roughly a worst-case headway wait)
// so the search favours fewer, longer legs — walking a bit further rather than hopping
// buses — while still treating actual walking time as cheap.
export const ROUTE_PROFILES = {
    lessWalking: { walkTimeWeight: 3, waitTimeWeight: 1.5, transferPenalty: 120 },
    lessTransit: { walkTimeWeight: 1, waitTimeWeight: 1.2, transferPenalty: 900 },
} as const satisfies Record<string, CostWeights>;

export type RouteProfileKey = keyof typeof ROUTE_PROFILES;

type PathStep = {
    stopId: string;
    via: { kind: "ride" | "transfer"; inVehicleTime: number; walkingTime: number; waitingTime: number } | null;
};

/**
 * Totals an A* path's cost components under `weights`. `initialWaitSeconds` is the
 * wait for the very first vehicle boarded — astar.ts only prices per-edge cost, so
 * boarding wait is added by the caller (see bus-graph.ts's `stopWaitSeconds`).
 */
export function summarizePath(path: PathStep[], weights: CostWeights, initialWaitSeconds: number) {
    let inVehicleTime = 0, walkingTime = 0, waitingTime = initialWaitSeconds, numTransfers = 0;
    for (const step of path) {
        if (!step.via) continue;
        inVehicleTime += step.via.inVehicleTime;
        walkingTime += step.via.walkingTime;
        waitingTime += step.via.waitingTime;
        if (step.via.kind === "transfer") numTransfers++;
    }
    return {
        inVehicleTime,
        walkingTime,
        waitingTime,
        numTransfers,
        totalSeconds: inVehicleTime + walkingTime + waitingTime,
        weightedCost: inVehicleTime
            + weights.walkTimeWeight * walkingTime
            + weights.waitTimeWeight * waitingTime
            + weights.transferPenalty * numTransfers,
    };
}

/** Stable identity for a path, used to tell whether two profiles landed on the same route. */
export function pathSignature(path: { stopId: string }[]) {
    return path.map((step) => step.stopId).join(">");
}

type RideOrTransferStep = {
    stopId: string;
    via: { kind: "ride" | "transfer"; routeId?: string; inVehicleTime: number; walkingTime: number } | null;
};

/**
 * Collapses an A* path into a brief step-by-step outline — consecutive ride edges on
 * the same route become one "ride" step, consecutive transfer edges become one "walk"
 * step — so a caller can show "Walk 5 min → K5B → Walk 3 min" without walking every
 * stop-to-stop edge itself.
 */
export function stepsFromPath(
    path: RideOrTransferStep[],
    routesById: Map<string, { ref: string; name: string }>
): JourneyStep[] {
    const steps: JourneyStep[] = [];
    let i = 0;
    while (i < path.length - 1) {
        const via = path[i].via!;
        let seconds = 0;
        let j = i;
        if (via.kind === "ride") {
            const routeId = via.routeId!;
            while (j < path.length - 1 && path[j].via?.kind === "ride" && path[j].via?.routeId === routeId) {
                seconds += path[j].via!.inVehicleTime;
                j++;
            }
            const route = routesById.get(routeId);
            steps.push({
                type: "ride",
                routeRef: route?.ref ?? routeId,
                routeName: route?.name ?? null,
                durationMinutes: Math.round(seconds / 60),
            });
        } else {
            while (j < path.length - 1 && path[j].via?.kind === "transfer") {
                seconds += path[j].via!.walkingTime;
                j++;
            }
            steps.push({ type: "walk", durationMinutes: Math.round(seconds / 60) });
        }
        i = j;
    }
    return steps;
}
