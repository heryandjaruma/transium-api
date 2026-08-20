export type KelurahanMedia = {
    id: string
    createdAt: string
    type: string
    url: string
    alt: string | null
    copyright: string | null
}

export type Kelurahan = {
    id: string
    kelurahanName: string
    kecamatanName: string
    description: string | null
    /** Comma-separated, e.g. "Beach,Mountains" — the majority of what this kelurahan's destinations are like. */
    category: string | null
    thumbnails: KelurahanMedia[]
}
