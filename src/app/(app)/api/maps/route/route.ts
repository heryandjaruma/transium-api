import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDirections, parseMapsLang, TransportType } from "@/lib/apple-maps";

const TRANSPORT_TYPES: Record<string, TransportType> = {
    driving: "Automobile",
    walking: "Walking",
    cycling: "Cycling",
};

function parseLatLng(value: string | null): { lat: number; lng: number } | null {
    if (!value) return null;
    const parts = value.split(",").map(Number);
    if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
    const [lat, lng] = parts;
    return { lat, lng };
}

/**
 * Returns a walking route between two coordinates using Apple Maps.
 *
 * Query:
 * - `origin`: "lat,lng"
 * - `destination`: "lat,lng"
 * - `lang` (optional): "id-ID" (default) or "en-US" — language for navigation steps
 *
 * Returns the route distance, duration, geometry, and navigation steps.
 */
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;

    const origin = parseLatLng(params.get("origin"));
    const destination = parseLatLng(params.get("destination"));
    // const transportType = TRANSPORT_TYPES[params.get("transportType") ?? "walking"];
    const transportType = TRANSPORT_TYPES['walking']; // force to walk
    const lang = parseMapsLang(params.get("lang"));

    if (!origin || !destination || !transportType) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const data = await getDirections(env, origin, destination, transportType, lang);
    const route = data.routes?.[0];

    if (!route) {
        return NextResponse.json({ error: "No route found" }, { status: 404 });
    }

    const geometry: [number, number][] = [];
    const steps = (route.stepIndexes ?? []).map((i) => {
        const step = data.steps![i];
        const path = (data.stepPaths?.[step.stepPathIndex!] ?? []).map(
            (loc): [number, number] => [loc.longitude, loc.latitude]
        );
        // Step paths share their boundary point with the next step's path, per Apple's docs.
        geometry.push(...(geometry.length ? path.slice(1) : path));

        return {
            instructions: step.instructions,
            distanceMeters: step.distanceMeters,
            durationSeconds: step.durationSeconds,
            geometry: path,
        };
    });

    return NextResponse.json({
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        geometry,
        steps,
    });
}
