import type { ApplePlaceResult, AppleAutocompleteResult, SearchBias } from "@/lib/apple-maps"
import type { NominatimPlace } from "@/lib/nominatim"

// Bali's extent, [west, south, east, north] — matches BASEMAP_BOUNDS in
// transit-map-style.ts (pulled from the basemap pmtiles header). Every search in this
// app is biased to this region rather than accepting a caller-supplied location, since
// it's the only area the product covers.
const BALI_BOUNDS = [114.431564, -8.850025, 115.711499, -8.061589] as const
const [BALI_WEST, BALI_SOUTH, BALI_EAST, BALI_NORTH] = BALI_BOUNDS

export const BALI_BIAS: SearchBias = {
    searchRegion: `${BALI_NORTH},${BALI_EAST},${BALI_SOUTH},${BALI_WEST}`,
}

// Caps how many results each endpoint returns, so a response stays small regardless of
// how many candidates a provider hands back.
export const MAX_SUGGESTIONS = 8

export interface PlaceSuggestion {
    label: string
    sublabel: string | null
    lat: number
    lng: number
}

export interface AutocompleteSuggestion {
    label: string
    sublabel: string | null
    /** Null for completions Apple hasn't resolved to a location yet — see resolveToken. */
    lat: number | null
    lng: number | null
    /** Pass to GET /api/maps/search/resolve to get coordinates. Set only when lat/lng are null. */
    resolveToken: string | null
}

function splitLabel(name: string | undefined, addressLines: string[] | undefined): { label: string; sublabel: string | null } {
    // Apple sometimes embeds newlines within a single address line — flatten everything
    // to one clean comma-separated string for display.
    const address = addressLines?.length ? addressLines.join(", ").replace(/\s*\n\s*/g, ", ") : null
    if (name) return { label: name, sublabel: address }
    return { label: address ?? "Unknown place", sublabel: null }
}

/** Trims Apple's /v1/search or /v1/geocode results down to what a client needs. */
export function toPlaceSuggestions(results: ApplePlaceResult[] | undefined): PlaceSuggestion[] {
    return (results ?? [])
        .filter((r) => r.coordinate)
        .slice(0, MAX_SUGGESTIONS)
        .map((r) => ({
            ...splitLabel(r.name, r.formattedAddressLines),
            lat: r.coordinate!.latitude,
            lng: r.coordinate!.longitude,
        }))
}

/** Trims Apple's /v1/searchAutocomplete results down to what a client needs. */
export function toAutocompleteSuggestions(results: AppleAutocompleteResult[] | undefined): AutocompleteSuggestion[] {
    return (results ?? [])
        .map((r) => {
            const [label, ...rest] = r.displayLines?.length ? r.displayLines : ["Unknown place"]
            return {
                label,
                sublabel: rest.length ? rest.join(", ") : null,
                lat: r.location?.latitude ?? null,
                lng: r.location?.longitude ?? null,
                resolveToken: r.location ? null : r.completionUrl ?? null,
            }
        })
        // A completion with neither a location nor a way to resolve one is useless to a caller.
        .filter((r) => r.lat !== null || r.resolveToken !== null)
        .slice(0, MAX_SUGGESTIONS)
}

/** Converts a Nominatim result into the same shape Apple-backed results use. */
export function fromNominatimPlace(place: NominatimPlace): PlaceSuggestion {
    const [label, ...rest] = place.display_name.split(", ")
    return {
        label,
        sublabel: rest.length ? rest.join(", ") : null,
        lat: parseFloat(place.lat),
        lng: parseFloat(place.lon),
    }
}
