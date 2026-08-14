import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { buildGraph } from "@/lib/bus-graph";
import { astar } from "@/lib/astar";
import { loadRouteShapes, withLegGeometry } from "@/lib/route-geometry";

/**
 * Return the path between `from` and `to`.
 * @param Request
 * @returns Object with fields `path` contains legs.
 * Example like below.
 * ```json
 * {
 *   "stopId": "cd2cca12-9be9-5328-b476-4ea7e0cc7c08",
 *   "name": "BNDCC",
 *   "via": {
 *     "to": "93b36a0c-2327-57ca-9d81-8c7936519a60",
 *     "weight": 422.56358299014215,
 *     "kind": "ride",
 *     "routeId": "0377a5c0-3000-5ff0-b55f-56467e93b3e2",
 *     "geometry": [[115.2537, -8.7089], [115.2540, -8.7091], "..."]
 *   }
 * }
 * ```
 * `kind` can be `ride` or `transfer`. `geometry` is the road-following path for this
 * leg as [lng, lat] pairs — sliced from the route's shape for `ride` legs, a straight
 * two-point line for `transfer` legs.
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
    const { graph, stops } = await buildGraph(env.DB)

    if (!stops.has(from) || !stops.has(to)) {
        return NextResponse.json({ error: "Unknown stop id" }, { status: 404 })
    }

    const path = astar(graph, stops, from, to)
    if (!path) {
        return NextResponse.json({ error: "No route found" }, { status: 404 })
    }

    const routeShapes = await loadRouteShapes(env.DB)
    const pathWithGeometry = withLegGeometry(path, stops, routeShapes)

    return NextResponse.json({
        path: pathWithGeometry.map((step) => ({
            stopId: step.stopId,
            name: stops.get(step.stopId)?.name,
            via: step.via,
        })),
    })
}