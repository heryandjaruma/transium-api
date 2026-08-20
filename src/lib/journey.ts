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
    durationSeconds: number
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
    durationSeconds: number
    geometry: [number, number][]
}

export type MissionSegment = {
    type: "mission"
    instructions: string
    lat?: number
    lng?: number
}

export type JourneySegment = WalkSegment | TransferSegment | BusSegment | MissionSegment

export type JourneySummary = {
    distanceMeters: number
    walkingDistanceMeters: number
    walkingDurationSeconds: number
    transitDistanceMeters: number
    busLegCount: number
    transferCount: number
}

// A brief, glanceable outline of a journey — e.g. "Walk 5 min", "K5B", "Walk 3 min" —
// so a user can tell what a route mostly looks like without reading every segment. The
// "mission" entry (real journeys only) is a sign-post: something the user must do at
// that point in the outline, not a leg to walk or ride.
export type JourneyStep =
    | { type: "walk"; durationMinutes: number }
    | { type: "ride"; routeRef: string; routeName: string | null; durationMinutes: number }
    | { type: "mission"; instructions: string; lat?: number; lng?: number }

export type JourneyOverview = {
    origin: LatLng
    destination: LatLng
    summary: JourneySummary
    segments: JourneySegment[]
    steps: JourneyStep[]
}

export type RouteProfileKey = "lessWalking" | "lessTransit"

export const ROUTE_PROFILE_LABELS: Record<RouteProfileKey, string> = {
    lessWalking: "Less walking",
    lessTransit: "Fewer transfers",
}

export type JourneyAlternatives = Record<RouteProfileKey, JourneyOverview | null>

// Response shape for /api/journey/overview: `best` is always present (the lessWalking
// result when both profiles agree, since the two are then identical); `lessWalking`/
// `lessTransit` are only included when they genuinely differ, per `alternativesAvailable`.
export type JourneyOverviewResponse = {
    alternativesAvailable: boolean
    best: JourneyOverview
    lessWalking?: JourneyOverview
    lessTransit?: JourneyOverview
}
