import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { resolveCompletion } from "@/lib/apple-maps";
import { toPlaceSuggestions } from "@/lib/places";

/**
 * Resolves a `resolveToken` from GET /api/maps/search into coordinates. Only needed
 * for the minority of suggestions that come back without `lat`/`lng` — call this once,
 * when the user actually picks one of those, not on every keystroke.
 *
 * Query:
 * - `token`: the `resolveToken` value from a /api/maps/search result (required)
 */
export async function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get("token");

    if (!token || !token.startsWith("/v1/search?")) {
        return NextResponse.json({ error: "Invalid arguments" }, { status: 400 });
    }

    const { env } = getCloudflareContext();
    const data = await resolveCompletion(env, token);

    return NextResponse.json({ results: toPlaceSuggestions(data.results) });
}
