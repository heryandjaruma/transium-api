import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { geocode } from "@/lib/apple-maps";
import { searchNominatim } from "@/lib/nominatim";
import { BALI_BIAS, MAX_SUGGESTIONS, toPlaceSuggestions, fromNominatimPlace } from "@/lib/places";

/**
 * Resolves a full address or place name entered in one go — not as-you-type, see
 * GET /api/maps/search for that. Tries Apple Maps first; since Apple's address
 * coverage in Indonesia is patchy, falls back to OpenStreetMap (Nominatim, which tends
 * to have denser community-mapped coverage here) only when Apple comes back with
 * nothing, so the OSM call is never made speculatively.
 *
 * Query:
 * - `q`: the address or place text to resolve (required)
 *
 * Returns `{ results, source }` — `source` is `"apple"` or `"osm"`, whichever provider
 * actually produced the results.
 */
export async function GET(request: NextRequest) {
    const query = request.nextUrl.searchParams.get("q")?.trim();

    if (!query) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const data = await geocode(env, query, BALI_BIAS);
    const appleResults = toPlaceSuggestions(data.results);

    if (appleResults.length) {
        return NextResponse.json(
            { results: appleResults, source: "apple" },
            { headers: { "Cache-Control": "private, max-age=60" } }
        );
    }

    const osmResults = await searchNominatim(query, MAX_SUGGESTIONS);
    return NextResponse.json(
        { results: osmResults.map(fromNominatimPlace), source: "osm" },
        { headers: { "Cache-Control": "private, max-age=60" } }
    );
}
