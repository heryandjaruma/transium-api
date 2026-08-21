import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { parseMapsLang, reverseGeocode } from "@/lib/apple-maps";
import { reverseNominatim } from "@/lib/nominatim";
import { fromNominatimPlace, MAX_SUGGESTIONS, toPlaceSuggestions } from "@/lib/places";

function parseCoordinate(value: string | null, min: number, max: number): number | null {
    if (!value?.trim()) return null;

    const coordinate = Number(value);
    return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max ? coordinate : null;
}

/**
 * Converts the caller's current coordinates into a readable address.
 * Tries Apple Maps first and falls back to OpenStreetMap (Nominatim) when Apple
 * has no result, matching GET /api/maps/geocode's provider behavior.
 *
 * Query:
 * - `lat`: latitude between -90 and 90 (required)
 * - `lng`: longitude between -180 and 180 (required)
 * - `lang`: `id-ID`/`id` or `en-US`/`en` (optional, defaults to `en-US`)
 *
 * Returns `{ results, source }`, where `source` is the provider that produced
 * the address.
 */
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const lat = parseCoordinate(params.get("lat"), -90, 90);
    const lng = parseCoordinate(params.get("lng"), -180, 180);
    const lang = parseMapsLang(params.get("lang"));

    if (lat === null || lng === null) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const data = await reverseGeocode(env, { lat, lng }, lang);
    const appleResults = toPlaceSuggestions(data.results).slice(0, MAX_SUGGESTIONS);

    if (appleResults.length) {
        return NextResponse.json(
            { results: appleResults, source: "apple" },
            { headers: { "Cache-Control": "private, max-age=60" } }
        );
    }

    const osmResult = await reverseNominatim(lat, lng);
    return NextResponse.json(
        {
            results: osmResult ? [fromNominatimPlace(osmResult)] : [],
            source: "osm",
        },
        { headers: { "Cache-Control": "private, max-age=60" } }
    );
}
