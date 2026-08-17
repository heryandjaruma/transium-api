import { BASEMAP_PMTILES_URL, TRANSIT_PMTILES_URL } from "@/lib/config";
import { getCloudflareContext } from "@opennextjs/cloudflare"

// Cloudflare Workers Static Assets (public/) doesn't honor Range requests,
// which pmtiles' client relies on for lazy tile loading. R2 supports native
// ranged reads, so tiles are served from there instead.
//
// TILE_KEYS maps the requested filename (the last path segment of the public
// URLs in config.ts) to its R2 object key, which lives under the same
// "tiles/" prefix in the "transium" bucket.
function basename(publicUrl: string): string {
    return publicUrl.slice(publicUrl.lastIndexOf("/") + 1)
}

const TILE_KEYS: Record<string, string> = {
    [basename(BASEMAP_PMTILES_URL)]: `tiles/${basename(BASEMAP_PMTILES_URL)}`,
    [basename(TRANSIT_PMTILES_URL)]: `tiles/${basename(TRANSIT_PMTILES_URL)}`,
}

type ParsedRange =
    | { type: "range"; offset: number; length: number }
    | { type: "none" }
    | { type: "unsatisfiable" }

function parseRange(header: string | null, size: number): ParsedRange {
    if (!header) return { type: "none" }

    const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim())
    if (!match) return { type: "none" }

    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) : size - 1
    if (start >= size) return { type: "unsatisfiable" }

    const clampedEnd = Math.min(end, size - 1)
    return { type: "range", offset: start, length: clampedEnd - start + 1 }
}

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
    const { file } = await params
    const key = TILE_KEYS[file]
    if (!key) {
        return new Response("Not found", { status: 404 })
    }

    const { env } = getCloudflareContext()
    const bucket = env.TILES_BUCKET

    const head = await bucket.head(key)
    if (!head) {
        return new Response("Not found", { status: 404 })
    }

    const range = parseRange(request.headers.get("range"), head.size)

    if (range.type === "unsatisfiable") {
        return new Response(null, {
            status: 416,
            headers: { "content-range": `bytes */${head.size}` },
        })
    }

    const object =
        range.type === "range"
            ? await bucket.get(key, { range: { offset: range.offset, length: range.length } })
            : await bucket.get(key)

    if (!object) {
        return new Response("Not found", { status: 404 })
    }

    const headers = new Headers()
    headers.set("accept-ranges", "bytes")
    headers.set("content-type", "application/octet-stream")
    headers.set("etag", object.httpEtag)
    headers.set("cache-control", "public, max-age=31536000, immutable")

    if (range.type === "range") {
        headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`)
        headers.set("content-length", String(range.length))
        return new Response(object.body, { status: 206, headers })
    }

    headers.set("content-length", String(head.size))
    return new Response(object.body, { status: 200, headers })
}
