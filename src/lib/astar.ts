import { MinPriorityQueue } from "@datastructures-js/priority-queue";
import { BUS_SPEED_MPS, Edge, Graph, haversine } from "./bus-graph";

type QueueItem = { id: string; priority: number }

// Routing objective:
//   cost = in_vehicle_time
//        + walkTimeWeight  * walking_time
//        + waitTimeWeight  * waiting_time
//        + transferPenalty * num_transfers
// in_vehicle_time is implicitly weighted 1 — every other term is priced relative to
// riding. Keep walkTimeWeight/waitTimeWeight >= 1 and transferPenalty >= 0: the
// heuristic below assumes riding straight at the goal is always the cheapest way to
// close ground, which only holds if nothing can be weighted below 1.
export type CostWeights = {
    walkTimeWeight: number;
    waitTimeWeight: number;
    transferPenalty: number;
}

export const DEFAULT_WEIGHTS: CostWeights = { walkTimeWeight: 1, waitTimeWeight: 1, transferPenalty: 0 }

function edgeCost(edge: Edge, weights: CostWeights) {
    return edge.inVehicleTime
        + weights.walkTimeWeight * edge.walkingTime
        + weights.waitTimeWeight * edge.waitingTime
        + (edge.kind === "transfer" ? weights.transferPenalty : 0)
}

export function astar(
    graph: Graph,
    stops: Map<string, { lat: number; lng: number; name: string }>,
    start: string,
    goal: string,
    weights: CostWeights = DEFAULT_WEIGHTS
) {
    const goalPos = stops.get(goal)!
    // Edge weights are seconds, so the heuristic must divide by the FASTEST mode to stay
    // admissible — nothing closes ground quicker than a bus heading straight at the goal.
    // Leaving this in metres would over-estimate ~6x and start returning wrong paths.
    const h = (id: string) => haversine(stops.get(id)!, goalPos) / BUS_SPEED_MPS

    const gScore = new Map([[start, 0]])
    const cameFrom = new Map<string, { from: string; edge: Edge }>()
    const open = new MinPriorityQueue<QueueItem>((item) => item.priority)
    open.enqueue({ id: start, priority: h(start) })
    const closed = new Set<string>()

    while (!open.isEmpty()) {
        const current = open.dequeue()!.id
        if (current === goal) return reconstruct(cameFrom, goal)
        if (closed.has(current)) continue
        closed.add(current)

        for (const edge of graph.get(current) ?? []) {
            const tentative = gScore.get(current)! + edgeCost(edge, weights)
            if (tentative < (gScore.get(edge.to) ?? Infinity)) {
                gScore.set(edge.to, tentative)
                cameFrom.set(edge.to, { from: current, edge })
                open.enqueue({ id: edge.to, priority: tentative + h(edge.to) })
            }
        }
    }
    return null
}

function reconstruct(cameFrom: Map<string, {from:string, edge:Edge}>, goal: string) {
    const path: { stopId:string; via: Edge | null}[] = [{stopId: goal, via: null}]
    let cur = goal
    while (cameFrom.has(cur)) {
        const { from, edge } = cameFrom.get(cur)!
        path.unshift({ stopId: from, via: edge})
        cur = from
    }
    return path
}