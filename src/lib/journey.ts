export type LatLng = { lat: number; lng: number }

export type WalkStep = {
    instructions?: string
    distanceMeters?: number
    durationSeconds?: number
    geometry: [number, number][]
}

export type JourneyStop = { stopId: string; name: string; lat: number; lng: number }

export type WalkSegment = {
    type: "walk"
    from: LatLng & { name: string; stopId?: string }
    to: LatLng & { name: string; stopId?: string }
    distanceMeters: number | null
    durationSeconds: number | null
    geometry: [number, number][]
    steps: WalkStep[]
}

export type TransferSegment = {
    type: "transfer"
    from: JourneyStop
    to: JourneyStop
    distanceMeters: number
    geometry: [number, number][]
}

export type BusSegment = {
    type: "bus"
    routeId: string
    routeRef: string | null
    routeName: string | null
    routeColor: string | null
    from: JourneyStop
    to: JourneyStop
    stops: { stopId: string; name: string; lat: number; lng: number }[]
    distanceMeters: number
    geometry: [number, number][]
}

export type JourneySegment = WalkSegment | TransferSegment | BusSegment

export type JourneySummary = {
    distanceMeters: number
    walkingDistanceMeters: number
    walkingDurationSeconds: number
    transitDistanceMeters: number
    busLegCount: number
    transferCount: number
}

export type JourneyOverview = {
    origin: LatLng
    destination: LatLng
    summary: JourneySummary
    segments: JourneySegment[]
}
