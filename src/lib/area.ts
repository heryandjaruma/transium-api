export type AreaMedia = {
    id: string
    createdAt: string
    type: string
    url: string
    alt: string | null
    copyright: string | null
}

export type Area = {
    id: string
    name: string
    description: string | null
    /** Comma-separated, e.g. "Beach,Mountains" — the majority of what this area's destinations are like. */
    category: string | null
    /** Center point, used to estimate distance to this area. */
    lat: number
    lng: number
    thumbnails: AreaMedia[]
}
