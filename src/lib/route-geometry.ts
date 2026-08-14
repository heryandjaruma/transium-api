import lineSlice from "@turf/line-slice";
import { lineString, point } from "@turf/helpers";
import { Edge } from "./bus-graph";

type LngLat = [number, number];

export async function loadRouteShapes(db: D1Database): Promise<Map<string, LngLat[]>> {
    const res = await db.prepare(`SELECT id, shape FROM BusRoute WHERE shape IS NOT NULL`).all();
    return new Map(
        (res.results as any[]).map((r) => [r.id as string, JSON.parse(r.shape as string) as LngLat[]])
    );
}

/**
 * Attaches a road-following `geometry` (GeoJSON [lng, lat] coordinates) to each
 * leg's `via`. Ride legs are sliced out of the route's full shape between the
 * two stops with turf's lineSlice; transfer legs get a straight two-point line.
 */
export function withLegGeometry(
    path: { stopId: string; via: Edge | null }[],
    stops: Map<string, { lat: number; lng: number; name: string }>,
    routeShapes: Map<string, LngLat[]>
) {
    return path.map((step) => {
        if (!step.via) return step;

        const from = stops.get(step.stopId)!;
        const to = stops.get(step.via.to)!;
        const shape = step.via.routeId ? routeShapes.get(step.via.routeId) : undefined;

        const geometry: LngLat[] = shape
            ? (lineSlice(point([from.lng, from.lat]), point([to.lng, to.lat]), lineString(shape))
                  .geometry.coordinates as LngLat[])
            : [
                  [from.lng, from.lat],
                  [to.lng, to.lat],
              ];

        return { ...step, via: { ...step.via, geometry } };
    });
}
