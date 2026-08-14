import { MinPriorityQueue } from "@datastructures-js/priority-queue";
import { Edge, Graph, haversine } from "./bus-graph";

type QueueItem = { id: string; priority: number }

export function astar(graph: Graph, stops: Map<string, { lat: number; lng: number; name: string }>, start: string, goal: string) {
    const goalPos = stops.get(goal)!
    const h = (id: string) => haversine(stops.get(id)!, goalPos)

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
            const tentative = gScore.get(current)! + edge.weight
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