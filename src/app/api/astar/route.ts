import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { buildGraph } from "@/lib/bus-graph";
import { astar } from "@/lib/astar";
import { loadRouteShapes, withLegGeometry } from "@/lib/route-geometry";
import { ROUTE_PROFILES, summarizePath } from "@/lib/path-cost";

type PathStep = { stopId: string; via: { kind: "ride" | "transfer"; inVehicleTime: number; walkingTime: number; waitingTime: number } | null }

/**
 * Return the path between `from` and `to`, once optimised for less walking and once
 * for fewer transit transfers.
 * @param Request
 * @returns Object with `lessWalking` and `lessTransit` fields, each (or `null` if no
 * route exists under that profile) containing `path` and a `cost` breakdown.
 * Example like below.
 * ```json
 * {
 *   "lessWalking": {
 *     "path": [{
 *       "stopId": "cd2cca12-9be9-5328-b476-4ea7e0cc7c08",
 *       "name": "BNDCC",
 *       "via": {
 *         "to": "93b36a0c-2327-57ca-9d81-8c7936519a60",
 *         "kind": "ride",
 *         "routeId": "0377a5c0-3000-5ff0-b55f-56467e93b3e2",
 *         "inVehicleTime": 90.5,
 *         "walkingTime": 0,
 *         "waitingTime": 0,
 *         "geometry": [[115.2537, -8.7089], [115.2540, -8.7091], "..."]
 *       }
 *     }],
 *     "cost": {
 *       "inVehicleTime": 512.3,
 *       "walkingTime": 84.1,
 *       "waitingTime": 630,
 *       "numTransfers": 1,
 *       "totalSeconds": 1226.4,
 *       "weightedCost": 1673.5
 *     }
 *   },
 *   "lessTransit": { "...": "same shape" }
 * }
 * ```
 * `kind` can be `ride` or `transfer`. `geometry` is the road-following path for this
 * leg as [lng, lat] pairs — sliced from the route's shape for `ride` legs, a straight
 * two-point line for `transfer` legs. `waitingTime` on ride/transfer legs comes from
 * each route's HeadwayBand (halved, assuming uniform arrivals); `cost.waitingTime`
 * also includes the wait for the very first bus boarded, priced the same way.
 */
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams

    const from = params.get('from')
    const to = params.get('to')

    if (!from || !to) {
        return NextResponse.json({
            error: "Invalid arguments"
        }, {status: 400})
    }

    const { env } = getCloudflareContext()
    const { graph, stops, stopWaitSeconds } = await buildGraph(env.DB)

    if (!stops.has(from) || !stops.has(to)) {
        return NextResponse.json({ error: "Unknown stop id" }, { status: 404 })
    }

    const routeShapes = await loadRouteShapes(env.DB)

    const results: Record<string, unknown> = {}
    for (const [key, weights] of Object.entries(ROUTE_PROFILES)) {
        const path = astar(graph, stops, from, to, weights)
        if (!path) {
            results[key] = null
            continue
        }

        const pathWithGeometry = withLegGeometry(path, stops, routeShapes)
        const boardsAVehicle = path.some((step) => step.via?.kind === "ride")
        const initialWaitSeconds = boardsAVehicle ? (stopWaitSeconds.get(from) ?? 0) : 0

        results[key] = {
            path: pathWithGeometry.map((step) => ({
                stopId: step.stopId,
                name: stops.get(step.stopId)?.name,
                via: step.via,
            })),
            cost: summarizePath(path as PathStep[], weights, initialWaitSeconds),
        }
    }

    if (!results.lessWalking && !results.lessTransit) {
        return NextResponse.json({ error: "No route found" }, { status: 404 })
    }

    return NextResponse.json(results)
}
