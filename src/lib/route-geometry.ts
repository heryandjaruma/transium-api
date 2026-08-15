import lineSlice from "@turf/line-slice";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import { lineString, point } from "@turf/helpers";
import { Edge, haversine } from "./bus-graph";

type LngLat = [number, number];
type LatLng = { lat: number; lng: number };

export async function loadRouteShapes(db: D1Database): Promise<Map<string, LngLat[]>> {
    const res = await db.prepare(`SELECT id, shape FROM BusRoute WHERE shape IS NOT NULL`).all();
    return new Map(
        (res.results as any[]).map((r) => [r.id as string, JSON.parse(r.shape as string) as LngLat[]])
    );
}

function lineLengthMeters(coords: LngLat[]) {
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        total += haversine({ lat: coords[i][1], lng: coords[i][0] }, { lat: coords[i + 1][1], lng: coords[i + 1][0] });
    }
    return total;
}

// Leading slice of `coords` covering at least `maxMeters` of length (one point past
// the boundary), used to bound how far ahead of the cursor a hop is allowed to search.
function takePrefixByDistance(coords: LngLat[], maxMeters: number) {
    let dist = 0;
    for (let i = 1; i < coords.length; i++) {
        dist += haversine({ lat: coords[i - 1][1], lng: coords[i - 1][0] }, { lat: coords[i][1], lng: coords[i][0] });
        if (dist > maxMeters) return coords.slice(0, i + 1);
    }
    return coords;
}

/**
 * Slices one ride hop's geometry out of `remaining` (the route shape from wherever
 * the previous hop left off). Routes that loop or double back — an out-and-back
 * spur, opposite carriageways — can pass close to the same stop more than once;
 * naively taking the globally nearest point on the shape can snap to an occurrence
 * dozens of stops away, which then starves every later hop of its correct segment.
 * So this searches a window sized to the hop's straight-line distance first,
 * widening to the full remainder only if nothing plausible is nearby, and falls
 * back to a straight line if the slice is still wildly disproportionate.
 */
function sliceHop(remaining: LngLat[], from: LatLng, to: LatLng): { geometry: LngLat[]; remaining: LngLat[] } {
    const straightLine: LngLat[] = [
        [from.lng, from.lat],
        [to.lng, to.lat],
    ];
    if (remaining.length < 2) return { geometry: straightLine, remaining };

    const straight = haversine(from, to);
    const fromPt = point([from.lng, from.lat]);
    const toPt = point([to.lng, to.lat]);

    let searchSpace = takePrefixByDistance(remaining, Math.max(straight * 6, 1500));
    let nearest = nearestPointOnLine(lineString(searchSpace), toPt, { units: "meters" });
    if ((nearest.properties.pointDistance ?? Infinity) > 100) {
        searchSpace = remaining;
        nearest = nearestPointOnLine(lineString(searchSpace), toPt, { units: "meters" });
    }

    const candidate = lineSlice(fromPt, toPt, lineString(searchSpace)).geometry.coordinates as LngLat[];
    if (lineLengthMeters(candidate) > Math.max(straight * 5, straight + 1000)) {
        return { geometry: straightLine, remaining };
    }

    const next = remaining.slice(nearest.properties.segmentIndex ?? 0);
    return { geometry: candidate, remaining: next.length >= 2 ? next : remaining };
}

/**
 * Attaches a road-following `geometry` (GeoJSON [lng, lat] coordinates) to each
 * leg's `via`. Ride legs are sliced out of the route's shape, walking forward stop
 * by stop so repeated stops in a looping route resolve to the right occurrence (see
 * `sliceHop`); transfer legs get a straight two-point line.
 */
export function withLegGeometry(
    path: { stopId: string; via: Edge | null }[],
    stops: Map<string, { lat: number; lng: number; name: string }>,
    routeShapes: Map<string, LngLat[]>
) {
    const result: { stopId: string; via: (Edge & { geometry: LngLat[] }) | null }[] = [];
    let activeRouteId: string | null = null;
    let remainingShape: LngLat[] = [];

    for (const step of path) {
        if (!step.via) {
            result.push({ stopId: step.stopId, via: null });
            continue;
        }

        const from = stops.get(step.stopId)!;
        const to = stops.get(step.via.to)!;

        if (step.via.kind !== "ride" || !step.via.routeId) {
            activeRouteId = null;
            result.push({
                ...step,
                via: { ...step.via, geometry: [[from.lng, from.lat], [to.lng, to.lat]] as LngLat[] },
            });
            continue;
        }

        if (step.via.routeId !== activeRouteId) {
            activeRouteId = step.via.routeId;
            remainingShape = routeShapes.get(activeRouteId) ?? [];
        }

        const { geometry, remaining } = sliceHop(remainingShape, from, to);
        remainingShape = remaining;
        result.push({ ...step, via: { ...step.via, geometry } });
    }

    return result;
}
