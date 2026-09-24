import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Return all bus stops. `stopId` is the source gpkg id (matches the
 * `stop_id` property on the transit vector tiles' bus_stops layer), `id`
 * is the D1 id `/api/route` expects for `from`/`to`.
 */
export async function GET() {
    const { env } = getCloudflareContext()
    const res = await env.DB.prepare(`SELECT id, stopId, name, lat, lng FROM BusStop`).all()
    return NextResponse.json({ stops: res.results })
}
