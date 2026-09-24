import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { buildGraph } from "@/lib/bus-graph";
import { astar, CostWeights } from "@/lib/astar";
import { loadRouteShapes, withLegGeometry } from "@/lib/route-geometry";
import { ROUTE_PROFILES, pathSignature, stepsFromPath, summarizePath } from "@/lib/path-cost";

/**
 * Return the path between `from` and `to`, optimised once for less walking and once
 * for fewer transit transfers.
 * @param Request
 * @returns `{ alternativesAvailable, best, lessWalking?, lessTransit? }`. `best` is
 * always present — it's the lessWalking result when the two profiles land on the same
 * physical path, in which case `alternativesAvailable` is `false` and `lessWalking`/
 * `lessTransit` are omitted. When the profiles genuinely differ, `alternativesAvailable`
 * is `true` and both `lessWalking` and `lessTransit` are included alongside `best`
 * (which defaults to the lessWalking result).
 * Example like below.
 * ```json
 * {
 *   "alternativesAvailable": true,
 *   "best": {
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
 *     },
 *     "steps": [
 *       { "type": "walk", "durationMinutes": 4 },
 *       { "type": "ride", "routeRef": "K5B", "routeName": "Kuta - Ubud", "durationMinutes": 12 },
 *       { "type": "walk", "durationMinutes": 2 }
 *     ]
 *   },
 *   "lessWalking": { "...": "same shape as best" },
 *   "lessTransit": { "...": "same shape as best" }
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
    const routesRes = await env.DB.prepare(`SELECT id, ref, name FROM BusRoute`).all()
    const routesById = new Map(
        (routesRes.results as any[]).map((r) => [r.id as string, r as { ref: string; name: string }])
    )

    function buildProfile(weights: CostWeights) {
        const path = astar(graph, stops, from!, to!, weights)
        if (!path) return null

        const pathWithGeometry = withLegGeometry(path, stops, routeShapes)
        const boardsAVehicle = path.some((step) => step.via?.kind === "ride")
        const initialWaitSeconds = boardsAVehicle ? (stopWaitSeconds.get(from!) ?? 0) : 0

        return {
            signature: pathSignature(path),
            result: {
                path: pathWithGeometry.map((step) => ({
                    stopId: step.stopId,
                    name: stops.get(step.stopId)?.name,
                    via: step.via,
                })),
                cost: summarizePath(path, weights, initialWaitSeconds),
                steps: stepsFromPath(path, routesById),
            },
        }
    }

    const lessWalking = buildProfile(ROUTE_PROFILES.lessWalking)
    const lessTransit = buildProfile(ROUTE_PROFILES.lessTransit)

    if (!lessWalking && !lessTransit) {
        return NextResponse.json({ error: "No route found" }, { status: 404 })
    }

    const alternativesAvailable = !!lessWalking && !!lessTransit && lessWalking.signature !== lessTransit.signature

    const results: Record<string, unknown> = {
        alternativesAvailable,
        best: (lessWalking ?? lessTransit)!.result,
    }
    if (alternativesAvailable) {
        results.lessWalking = lessWalking!.result
        results.lessTransit = lessTransit!.result
    }

    return NextResponse.json(results)
}
