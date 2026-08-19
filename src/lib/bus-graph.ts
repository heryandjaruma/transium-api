export type Edge = {
    to: string;
    weight: number;
    distanceMeters: number;
    kind: "ride" | "transfer";
    routeId?: string;
    // Marks a "transfer" edge as a walk straight to/from a request-scoped virtual
    // origin/destination node (see journey-planner.ts's withVirtualEndpoints) rather
    // than a real mid-trip change of vehicle — never set on anything buildGraph
    // returns. astar.ts's edgeCost checks this to exempt the edge from
    // transferPenalty: boarding/alighting isn't a transfer, it's the trip's own
    // start/end.
    isAccess?: boolean;
    // Cost components, seconds. Ride edges only ever populate inVehicleTime; transfer
    // edges only ever populate walkingTime/waitingTime. `weight` stays the sum of
    // whichever apply, so it keeps meaning "unweighted time for this edge" for callers
    // that just want an ETA (see astar.ts's DEFAULT_WEIGHTS) or a plain Dijkstra cost.
    inVehicleTime: number;
    walkingTime: number;
    waitingTime: number;
}
export type Graph = Map<string, Edge[]>

// Edge weights are travel-time estimates in SECONDS; `distanceMeters` stays in metres.
// Time is what the search must minimise, not distance: charging a metre of riding the
// same as a metre of walking makes staying on the bus never pay off, because a ride hop
// can only ever close the straight-line gap to the goal by at most its own length.
export const WALK_SPEED_MPS = 1.35
export const BUS_SPEED_MPS = (20 * 1000) / 3600 // 20 km/h assumed in-vehicle speed

const TRANSFER_RADIUS_M = 250
// Fallback headway (minutes) for routes with no HeadwayBand row (e.g. new/unsurveyed
// routes) so a missing row degrades to a plausible average wait rather than zero.
const DEFAULT_HEADWAY_MINUTES = 20

export function haversine(
    a: {lat: number, lng: number},
    b: {lat: number, lng: number}
) {
    const R = 6371000 // earth radius
    const p1 = a.lat * Math.PI/180, p2 = b.lat * Math.PI/180
    const dp = (b.lat-a.lat) * Math.PI/180, dl = (b.lng-a.lng) * Math.PI/180
    const x = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2
    return 2 * R * Math.asin(Math.sqrt(x))
}

export async function buildGraph(db: D1Database): Promise<{
    graph: Graph,
    stops: Map<string, {lat:number, lng:number, name:string}>,
    // Average expected wait (seconds) for the next vehicle departing a stop, averaged
    // across whichever routes serve it. Used to price transfer edges and exposed so
    // callers can also price the very first boarding of a journey the same way (see
    // journey/overview and astar routes) — astar.ts itself only optimises per-edge cost.
    stopWaitSeconds: Map<string, number>,
}> {
    const stopRes = await db.prepare(`SELECT id, name, lat, lng FROM BusStop`).all()
    const stops = new Map(stopRes.results.map((s: any) => [s.id, s]))

    const graph: Graph = new Map([...stops.keys()].map(id => [id, []]))

    // ride edges: consecutive stops per route
    const rsRes = await db.prepare(
        `SELECT routeId, stopId, sequence FROM RouteStop ORDER BY routeId, sequence`
    ).all()
    const byRoute = new Map<string, any[]>()
    const stopRoutes = new Map<string, Set<string>>()
    for (const row of rsRes.results as any[]) {
        if (!byRoute.has(row.routeId)) byRoute.set(row.routeId, [])
        byRoute.get(row.routeId)!.push(row)
        if (!stopRoutes.has(row.stopId)) stopRoutes.set(row.stopId, new Set())
        stopRoutes.get(row.stopId)!.add(row.routeId)
    }

    const hbRes = await db.prepare(`SELECT routeId, headwayMinutes FROM HeadwayBand`).all()
    const headwaysByRoute = new Map<string, number[]>()
    for (const row of hbRes.results as any[]) {
        if (!headwaysByRoute.has(row.routeId)) headwaysByRoute.set(row.routeId, [])
        headwaysByRoute.get(row.routeId)!.push(row.headwayMinutes)
    }
    const routeHeadwayMinutes = new Map(
        [...headwaysByRoute].map(([routeId, vals]) => [routeId, vals.reduce((a, b) => a + b, 0) / vals.length])
    )

    // Average headway across a stop's routes, halved (uniform arrivals) for the
    // expected wait. Stops served by no known route (or an unsurveyed one) fall back
    // to DEFAULT_HEADWAY_MINUTES rather than under-pricing the wait as zero.
    const stopWaitSeconds = new Map<string, number>()
    for (const id of stops.keys()) {
        const routes = stopRoutes.get(id)
        const headways = routes?.size
            ? [...routes].map((r) => routeHeadwayMinutes.get(r) ?? DEFAULT_HEADWAY_MINUTES)
            : [DEFAULT_HEADWAY_MINUTES]
        const avgHeadwayMinutes = headways.reduce((a, b) => a + b, 0) / headways.length
        stopWaitSeconds.set(id, (avgHeadwayMinutes * 60) / 2)
    }

    for (const [routeId, rows] of byRoute) {
        for (let i = 0; i < rows.length - 1; i++) {
            const a = stops.get(rows[i].stopId)!, b = stops.get(rows[i+1].stopId)!
            const d = haversine(a, b)
            const inVehicleTime = d / BUS_SPEED_MPS
            graph.get(rows[i].stopId)!.push({
                to: rows[i+1].stopId, weight: inVehicleTime, distanceMeters: d, kind: "ride", routeId,
                inVehicleTime, walkingTime: 0, waitingTime: 0,
            })
        }
    }

    // transfer edges: proximity clustering across all stops (On^2), fine at n≈490.
    // Cost is the walk itself plus the expected wait for the next vehicle *at the stop
    // you land on*, so even a same-platform interchange (d≈0, e.g. route termini shared
    // between directions) pays for the change of bus rather than coming out free.
    const ids = [...stops.keys()]
    for (let i = 0; i < ids.length; i++) {
        for (let j = i+1; j < ids.length; j++) {
            const a = stops.get(ids[i])!, b = stops.get(ids[j])!
            const d = haversine(a, b)
            if (d <= TRANSFER_RADIUS_M) {
                const walkingTime = d / WALK_SPEED_MPS
                const waitAtJ = stopWaitSeconds.get(ids[j])!
                const waitAtI = stopWaitSeconds.get(ids[i])!
                graph.get(ids[i])!.push({
                    to: ids[j], weight: walkingTime + waitAtJ, distanceMeters: d, kind: "transfer",
                    inVehicleTime: 0, walkingTime, waitingTime: waitAtJ,
                })
                graph.get(ids[j])!.push({
                    to: ids[i], weight: walkingTime + waitAtI, distanceMeters: d, kind: "transfer",
                    inVehicleTime: 0, walkingTime, waitingTime: waitAtI,
                })
            }
        }
    }
    return { graph, stops, stopWaitSeconds }
}