import { CostWeights } from "./astar";

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
