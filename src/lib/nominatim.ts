const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org"

// Nominatim's public-instance usage policy (operations.osmfoundation.org/policies/nominatim)
// caps traffic at ~1 request/second and asks for a User-Agent identifying the calling
// app. This client is only ever called as a one-off fallback when Apple's geocoder
// comes back empty for an address or coordinate — never per keystroke — so a single
// ad-hoc request per user lookup stays well within that. If usage ever grows beyond occasional
// fallback lookups, self-host Nominatim or switch to a paid geocoder instead of
// leaning harder on the shared public instance.
const USER_AGENT = "TransiumAPI/1.0 (Bali public transit search)"

export interface NominatimPlace {
    display_name: string
    lat: string
    lon: string
}

/** Free-text address search via OpenStreetMap's Nominatim, limited to Indonesia. */
export async function searchNominatim(query: string, limit: number): Promise<NominatimPlace[]> {
    const params = new URLSearchParams({
        q: query,
        format: "jsonv2",
        limit: String(limit),
        countrycodes: "id",
    })

    const res = await fetch(`${NOMINATIM_BASE_URL}/search?${params}`, {
        headers: { "User-Agent": USER_AGENT },
    })

    if (!res.ok) {
        throw new Error(`Nominatim search request failed: ${res.status} ${await res.text()}`)
    }

    return res.json()
}

/** Reverse geocodes a coordinate via OpenStreetMap's Nominatim. */
export async function reverseNominatim(lat: number, lng: number): Promise<NominatimPlace | null> {
    const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lng),
        format: "jsonv2",
        zoom: "18",
    })

    const res = await fetch(`${NOMINATIM_BASE_URL}/reverse?${params}`, {
        headers: { "User-Agent": USER_AGENT },
    })

    if (!res.ok) {
        throw new Error(`Nominatim reverse request failed: ${res.status} ${await res.text()}`)
    }

    const place = (await res.json()) as Partial<NominatimPlace>
    return place.display_name && place.lat && place.lon
        ? {
            display_name: place.display_name,
            lat: place.lat,
            lon: place.lon,
        }
        : null
}
