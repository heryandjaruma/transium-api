import { getCloudflareContext } from "@opennextjs/cloudflare"

// Serves files uploaded to the "transium" R2 bucket under the "media/" prefix
// (e.g. quest thumbnails at media/system/quest/...). Media.url values are the
// request path here, one-to-one with the R2 object key — see media-storage.ts.
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
    const { key } = await params
    const objectKey = `media/${key.join("/")}`

    const { env } = getCloudflareContext()
    const object = await env.TILES_BUCKET.get(objectKey)
    if (!object) {
        return new Response("Not found", { status: 404 })
    }

    const headers = new Headers()
    headers.set("content-type", object.httpMetadata?.contentType ?? "application/octet-stream")
    headers.set("content-length", String(object.size))
    headers.set("etag", object.httpEtag)
    headers.set("cache-control", "public, max-age=31536000, immutable")
    headers.set("x-content-type-options", "nosniff")

    return new Response(object.body, { status: 200, headers })
}
