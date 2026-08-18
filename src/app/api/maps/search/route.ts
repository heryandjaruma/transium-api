import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { searchAutocomplete } from "@/lib/apple-maps";
import { BALI_BIAS, toAutocompleteSuggestions } from "@/lib/places";

/**
 * Search-as-you-type place/address suggestions for Bali, via Apple Maps. Cheap enough
 * to call on every keystroke (debounce client-side regardless of that).
 *
 * Query:
 * - `q`: partial search text (required)
 *
 * Each result has `label`/`sublabel` to display. Most already come back with
 * `lat`/`lng` ready to use; a few generic completions (query refinements Apple hasn't
 * pinned to one place yet) omit them and carry a `resolveToken` instead — pass that to
 * GET /api/maps/search/resolve once the user actually picks that suggestion, so most
 * keystrokes still cost just this one lightweight call.
 *
 * For a full address/place name typed or pasted in one go rather than as-you-type, see
 * GET /api/maps/geocode instead — it also falls back to OpenStreetMap for addresses
 * Apple's Indonesia coverage misses.
 */
export async function GET(request: NextRequest) {
    const query = request.nextUrl.searchParams.get("q")?.trim();

    if (!query) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const data = await searchAutocomplete(env, query, BALI_BIAS);

    return NextResponse.json(
        { results: toAutocompleteSuggestions(data.results) },
        { headers: { "Cache-Control": "private, max-age=30" } }
    );
}
