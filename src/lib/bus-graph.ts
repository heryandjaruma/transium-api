export type Edge = {
    to: string;
    weight: number;
    distanceMeters: number;
    kind: "ride" | "transfer";
    routeId?: string
}
export type Graph = Map<string, Edge[]>

// Edge weights are travel-time estimates in SECONDS; `distanceMeters` stays in metres.
// Time is what the search must minimise, not distance: charging a metre of riding the
// same as a metre of walking makes staying on the bus never pay off, because a ride hop
// can only ever close the straight-line gap to the goal by at most its own length.
export const WALK_SPEED_MPS = 1.35
export const BUS_SPEED_MPS = 6.0 // ~22 km/h, including dwell at stops

const TRANSFER_RADIUS_M = 250
// Interchange cost on top of the walk itself: waiting for the next vehicle. Flat,
// because that wait does not depend on how far you walked to reach the other stop.
const TRANSFER_WAIT_SECONDS = 180

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

export async function buildGraph(db: D1Database): Promise<{ graph: Graph, stops: Map<string, {lat:number, lng:number, name:string}> }> {
    const stopRes = await db.prepare(`SELECT id, name, lat, lng FROM BusStop`).all()
    const stops = new Map(stopRes.results.map((s: any) => [s.id, s]))

    const graph: Graph = new Map([...stops.keys()].map(id => [id, []]))

    // ride edges: consecutive stops per route
    const rsRes = await db.prepare(
        `SELECT routeId, stopId, sequence FROM RouteStop ORDER BY routeId, sequence`
    ).all()
    const byRoute = new Map<string, any[]>()
    for (const row of rsRes.results as any[]) {
        if (!byRoute.has(row.routeId)) byRoute.set(row.routeId, [])
        byRoute.get(row.routeId)!.push(row)
    }
    for (const [routeId, rows] of byRoute) {
        for (let i = 0; i < rows.length - 1; i++) {
            const a = stops.get(rows[i].stopId)!, b = stops.get(rows[i+1].stopId)!
            const d = haversine(a, b)
            graph.get(rows[i].stopId)!.push({ to: rows[i+1].stopId, weight: d / BUS_SPEED_MPS, distanceMeters: d, kind: "ride", routeId})
        }
    }
    
    // transfer edges: proximity clustering across all stops (On^2), fine at n≈490.
    // Cost is the walk itself plus a flat wait for the next vehicle, so even a
    // same-platform interchange (d≈0, e.g. route termini shared between directions)
    // pays for the change of bus rather than coming out free.
    const ids = [...stops.keys()]
    for (let i = 0; i < ids.length; i++) {
        for (let j = i+1; j < ids.length; j++) {
            const a = stops.get(ids[i])!, b = stops.get(ids[j])!
            const d = haversine(a, b)
            if (d <= TRANSFER_RADIUS_M) {
                const w = d / WALK_SPEED_MPS + TRANSFER_WAIT_SECONDS
                graph.get(ids[i])!.push({ to: ids[j], weight: w, distanceMeters: d, kind: "transfer"})
                graph.get(ids[j])!.push({ to: ids[i], weight: w, distanceMeters: d, kind: "transfer"})
            }
        }
    }
    return { graph, stops }
}