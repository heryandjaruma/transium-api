// OpenAPI document describing the public HTTP API. Served as JSON at
// /api/openapi.json and rendered by Scalar at /reference.
//
// Only documents /api/astar, /api/journey/overview, /api/maps/route, and the Quest-tagged
// paths for now — add other paths here as they get documented.

const journeyStepSchema = {
    description:
        "A brief, glanceable outline entry for what a journey mostly looks like — e.g. " +
        "`{type: \"walk\", durationMinutes: 5}` then `{type: \"ride\", routeRef: \"K5B\", ...}` — " +
        "without having to read every segment.",
    oneOf: [
        {
            type: "object",
            required: ["type", "durationMinutes"],
            properties: {
                type: { type: "string", enum: ["walk"] },
                durationMinutes: { type: "number", description: "Rounded to the nearest minute." },
            },
        },
        {
            type: "object",
            required: ["type", "routeRef", "routeName", "durationMinutes"],
            properties: {
                type: { type: "string", enum: ["ride"] },
                routeRef: { type: "string", description: "Short route code, e.g. \"K5B\"." },
                routeName: { type: ["string", "null"] },
                durationMinutes: { type: "number", description: "Rounded to the nearest minute." },
            },
        },
    ],
} as const

// Shared prose for the alternativesAvailable/best/lessWalking/lessTransit envelope
// used by both /astar and /journey/overview.
const alternativesEnvelopeDescription =
    "Every routing response is computed twice, under two cost profiles (see the `lessWalking`/`lessTransit` " +
    "weights) and wrapped the same way:\n\n" +
    "- `best` is always present. It's the `lessWalking` result, or the `lessTransit` result if `lessWalking` " +
    "found no route at all.\n" +
    "- `alternativesAvailable` is `true` only when both profiles found a route **and** the two routes are " +
    "physically different (different stop sequence). In that case `lessWalking` and `lessTransit` are both " +
    "included alongside `best`, so a caller can offer a choice.\n" +
    "- `alternativesAvailable` is `false` when the profiles agree (same route — the common case when only one " +
    "sensible option exists) or when only one profile found a route at all. Either way there's nothing to " +
    "choose between, so `lessWalking`/`lessTransit` are omitted and only `best` is returned."

export const openApiSpec = {
    openapi: "3.1.0",
    info: {
        title: "Transium API",
        version: "0.1.0",
        description: "Public transit routing API for Bali.",
    },
    servers: [{ url: "/api" }],
    tags: [
        {
            name: "Quest",
            description:
                "Quests are the discoverable activities shown to end users, each carrying thumbnail media and " +
                "one or more badges. A quest has no location of its own — it's reachable through any kelurahan " +
                "that one of its badges is scoped to (Badge.kelurahanId), and its origin/destination coordinates " +
                "for route preview come from its badges' step locations.",
        },
    ],
    components: {
        schemas: {
            JourneyStep: journeyStepSchema,
            JourneyStopRef: {
                type: "object",
                required: ["stopId", "name", "lat", "lng"],
                properties: {
                    stopId: { type: "string", format: "uuid" },
                    name: { type: "string" },
                    lat: { type: "number" },
                    lng: { type: "number" },
                },
            },
            AstarResult: {
                type: "object",
                required: ["path", "cost", "steps"],
                properties: {
                    path: {
                        type: "array",
                        items: {
                            type: "object",
                            required: ["stopId", "name", "via"],
                            properties: {
                                stopId: { type: "string", format: "uuid" },
                                name: { type: "string" },
                                via: {
                                    oneOf: [
                                        {
                                            type: "object",
                                            required: [
                                                "to", "weight", "distanceMeters", "kind",
                                                "inVehicleTime", "walkingTime", "waitingTime",
                                            ],
                                            properties: {
                                                to: { type: "string", format: "uuid", description: "Stop id this edge leads to." },
                                                weight: {
                                                    type: "number",
                                                    description: "Unweighted total time in seconds for this edge (inVehicleTime + walkingTime + waitingTime).",
                                                },
                                                distanceMeters: { type: "number", description: "True haversine distance in meters between the two stops." },
                                                kind: { type: "string", enum: ["ride", "transfer"] },
                                                routeId: { type: "string", format: "uuid", description: "Present when kind is ride." },
                                                inVehicleTime: { type: "number", description: "Seconds on board. 0 for transfer edges." },
                                                walkingTime: { type: "number", description: "Seconds walking. 0 for ride edges." },
                                                waitingTime: {
                                                    type: "number",
                                                    description: "Expected wait in seconds for the next vehicle, from HeadwayBand (headway halved). 0 for ride edges.",
                                                },
                                                geometry: {
                                                    type: "array",
                                                    description:
                                                        "Road-following [lng, lat] pairs for this leg — sliced from the route's shape for " +
                                                        "ride legs, a straight two-point line for transfer legs.",
                                                    items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                                                },
                                            },
                                        },
                                        { type: "null" },
                                    ],
                                },
                            },
                        },
                    },
                    cost: {
                        type: "object",
                        required: ["inVehicleTime", "walkingTime", "waitingTime", "numTransfers", "totalSeconds", "weightedCost"],
                        properties: {
                            inVehicleTime: { type: "number", description: "Total seconds on board across all ride edges." },
                            walkingTime: { type: "number", description: "Total seconds walking across all transfer edges." },
                            waitingTime: {
                                type: "number",
                                description: "Total expected wait in seconds, including the wait for the very first bus boarded.",
                            },
                            numTransfers: { type: "integer", description: "Number of walking transfers between stops taken." },
                            totalSeconds: {
                                type: "number",
                                description: "inVehicleTime + walkingTime + waitingTime — the unweighted real-world time estimate.",
                            },
                            weightedCost: {
                                type: "number",
                                description:
                                    "The cost this profile actually minimised: inVehicleTime + walkTimeWeight*walkingTime + " +
                                    "waitTimeWeight*waitingTime + transferPenalty*numTransfers.",
                            },
                        },
                    },
                    steps: { type: "array", items: { $ref: "#/components/schemas/JourneyStep" } },
                },
            },
            JourneyResult: {
                type: "object",
                required: ["origin", "destination", "summary", "segments", "steps"],
                properties: {
                    origin: {
                        type: "object",
                        required: ["lat", "lng"],
                        properties: { lat: { type: "number" }, lng: { type: "number" } },
                    },
                    destination: {
                        type: "object",
                        required: ["lat", "lng"],
                        properties: { lat: { type: "number" }, lng: { type: "number" } },
                    },
                    summary: {
                        type: "object",
                        required: [
                            "distanceMeters", "walkingDistanceMeters", "walkingDurationSeconds",
                            "transitDistanceMeters", "busLegCount", "transferCount",
                        ],
                        properties: {
                            distanceMeters: { type: "number", description: "Total walking + transit distance." },
                            walkingDistanceMeters: { type: "number" },
                            walkingDurationSeconds: { type: "number", description: "Real walking time from Apple Maps (initial + final legs only)." },
                            transitDistanceMeters: { type: "number", description: "Distance covered by bus legs and inter-stop transfers combined." },
                            busLegCount: { type: "integer" },
                            transferCount: { type: "integer" },
                        },
                    },
                    segments: {
                        type: "array",
                        items: {
                            oneOf: [
                                {
                                    type: "object",
                                    required: ["type", "from", "to", "distanceMeters", "durationSeconds", "geometry", "steps"],
                                    description: "A real walking leg (origin-to-stop or stop-to-destination) from Apple Maps.",
                                    properties: {
                                        type: { type: "string", enum: ["walk"] },
                                        from: {
                                            type: "object",
                                            required: ["lat", "lng", "name"],
                                            properties: {
                                                lat: { type: "number" }, lng: { type: "number" },
                                                name: { type: "string" }, stopId: { type: "string", format: "uuid" },
                                            },
                                        },
                                        to: {
                                            type: "object",
                                            required: ["lat", "lng", "name"],
                                            properties: {
                                                lat: { type: "number" }, lng: { type: "number" },
                                                name: { type: "string" }, stopId: { type: "string", format: "uuid" },
                                            },
                                        },
                                        distanceMeters: { type: ["number", "null"] },
                                        durationSeconds: { type: ["number", "null"] },
                                        geometry: {
                                            type: "array",
                                            items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                                        },
                                        steps: {
                                            type: "array",
                                            description: "Turn-by-turn walking steps from Apple Maps.",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    instructions: { type: "string" },
                                                    distanceMeters: { type: "number" },
                                                    durationSeconds: { type: "number" },
                                                    geometry: {
                                                        type: "array",
                                                        items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                                {
                                    type: "object",
                                    required: ["type", "from", "to", "distanceMeters", "durationSeconds", "geometry"],
                                    description: "A foot transfer between two nearby stops.",
                                    properties: {
                                        type: { type: "string", enum: ["transfer"] },
                                        from: { $ref: "#/components/schemas/JourneyStopRef" },
                                        to: { $ref: "#/components/schemas/JourneyStopRef" },
                                        distanceMeters: { type: "number" },
                                        durationSeconds: { type: "number", description: "Estimated walking time (distance at assumed walking speed)." },
                                        geometry: {
                                            type: "array",
                                            items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                                        },
                                    },
                                },
                                {
                                    type: "object",
                                    required: [
                                        "type", "routeId", "routeRef", "routeName", "routeColor",
                                        "from", "to", "stops", "distanceMeters", "durationSeconds", "geometry",
                                    ],
                                    description: "One or more consecutive stops ridden on the same bus route.",
                                    properties: {
                                        type: { type: "string", enum: ["bus"] },
                                        routeId: { type: "string", format: "uuid" },
                                        routeRef: { type: ["string", "null"] },
                                        routeName: { type: ["string", "null"] },
                                        routeColor: { type: ["string", "null"] },
                                        from: { $ref: "#/components/schemas/JourneyStopRef" },
                                        to: { $ref: "#/components/schemas/JourneyStopRef" },
                                        stops: {
                                            type: "array",
                                            description: "Every stop this leg passes through, including the boarding and alighting stop.",
                                            items: { $ref: "#/components/schemas/JourneyStopRef" },
                                        },
                                        distanceMeters: { type: "number" },
                                        durationSeconds: { type: "number", description: "Estimated in-vehicle time (assumed 20 km/h bus speed)." },
                                        geometry: {
                                            type: "array",
                                            items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                                        },
                                    },
                                },
                            ],
                        },
                    },
                    steps: { type: "array", items: { $ref: "#/components/schemas/JourneyStep" } },
                },
            },
            LatLng: {
                type: "object",
                required: ["lat", "lng"],
                properties: { lat: { type: "number" }, lng: { type: "number" } },
            },
            MediaAsset: {
                type: "object",
                required: ["id", "createdAt", "type", "url"],
                properties: {
                    id: { type: "string", format: "uuid" },
                    createdAt: { type: "string", format: "date-time" },
                    type: { type: "string", description: "MIME type, e.g. \"image/jpeg\"." },
                    url: { type: "string" },
                },
            },
            Quest: {
                type: "object",
                required: ["id", "name", "category", "description", "thumbnails"],
                properties: {
                    id: { type: "string", format: "uuid" },
                    name: { type: "string" },
                    category: { type: "string" },
                    description: { type: "string" },
                    thumbnails: { type: "array", items: { $ref: "#/components/schemas/MediaAsset" } },
                },
            },
            QuestBadgeEntry: {
                description: "A badge attached to a quest via QuestBadge (`id` is the link's own id, not the badge's).",
                type: "object",
                required: ["id", "questId", "badgeId", "badgeName", "badgeCategory", "badgeType", "badgeImageUrl"],
                properties: {
                    id: { type: "string", format: "uuid" },
                    questId: { type: "string", format: "uuid" },
                    badgeId: { type: "string", format: "uuid" },
                    badgeName: { type: "string" },
                    badgeCategory: { type: "string" },
                    badgeType: { type: "string" },
                    badgeImageUrl: { type: ["string", "null"] },
                },
            },
            BadgeActionStep: {
                type: "object",
                required: ["id", "badgeId", "actionId", "actionName", "actionType", "sequence", "lat", "lng", "instruction"],
                properties: {
                    id: { type: "string", format: "uuid" },
                    badgeId: { type: "string", format: "uuid" },
                    actionId: { type: "string", format: "uuid" },
                    actionName: { type: "string" },
                    actionType: { type: "string" },
                    sequence: { type: "integer", description: "Order of this step within its badge, ascending." },
                    lat: { type: ["number", "null"] },
                    lng: { type: ["number", "null"] },
                    instruction: { type: ["string", "null"] },
                },
            },
            QuestBadgeWithSteps: {
                type: "object",
                required: ["id", "badgeId", "badgeName", "badgeCategory", "badgeType", "badgeImageUrl", "steps"],
                properties: {
                    id: { type: "string", format: "uuid" },
                    badgeId: { type: "string", format: "uuid" },
                    badgeName: { type: "string" },
                    badgeCategory: { type: "string" },
                    badgeType: { type: "string" },
                    badgeImageUrl: { type: ["string", "null"] },
                    steps: {
                        type: "array",
                        description: "Ordered by sequence ascending.",
                        items: { $ref: "#/components/schemas/BadgeActionStep" },
                    },
                },
            },
            QuestDetail: {
                type: "object",
                required: ["id", "name", "category", "description", "thumbnails", "badges", "origin", "destination"],
                properties: {
                    id: { type: "string", format: "uuid" },
                    name: { type: "string" },
                    category: { type: "string" },
                    description: { type: "string" },
                    thumbnails: { type: "array", items: { $ref: "#/components/schemas/MediaAsset" } },
                    badges: { type: "array", items: { $ref: "#/components/schemas/QuestBadgeWithSteps" } },
                    origin: {
                        description:
                            "The first step (across badges, in attachment order) that has a lat/lng set, or " +
                            "null if none do. Pass straight through to /journey/overview's `origin` query param.",
                        oneOf: [{ $ref: "#/components/schemas/LatLng" }, { type: "null" }],
                    },
                    destination: {
                        description: "The last step with a lat/lng set, or null if fewer than two steps have coordinates.",
                        oneOf: [{ $ref: "#/components/schemas/LatLng" }, { type: "null" }],
                    },
                },
            },
            QuestWithBadges: {
                type: "object",
                required: ["id", "name", "category", "description", "thumbnails", "badges"],
                properties: {
                    id: { type: "string", format: "uuid" },
                    name: { type: "string" },
                    category: { type: "string" },
                    description: { type: "string" },
                    thumbnails: { type: "array", items: { $ref: "#/components/schemas/MediaAsset" } },
                    badges: { type: "array", items: { $ref: "#/components/schemas/QuestBadgeEntry" } },
                },
            },
            Kelurahan: {
                type: "object",
                required: ["id", "kelurahanName", "kecamatanName"],
                properties: {
                    id: { type: "string" },
                    kelurahanName: { type: "string" },
                    kecamatanName: { type: "string" },
                },
            },
        },
    },
    paths: {
        // "/astar": {
        //     get: {
        //         summary: "Find a route between two stops, less-walking and less-transit alike",
        //         description:
        //             "Computes the cheapest path between two bus stops with A* search over the transit graph, " +
        //             "once optimised for less walking and once for fewer transfers.\n\n" +
        //             "Each entry in a `path` is a stop; its `via` field describes the edge taken from that stop " +
        //             "to the next one (`ride` along a bus route, or `transfer` on foot between nearby stops). " +
        //             "The final stop's `via` is `null`. `waitingTime` on ride/transfer edges, and the boarding " +
        //             "wait folded into `cost.waitingTime`, come from each route's HeadwayBand (headway halved, " +
        //             "assuming uniform arrivals).\n\n" +
        //             alternativesEnvelopeDescription,
        //         parameters: [
        //             {
        //                 name: "from",
        //                 in: "query",
        //                 required: true,
        //                 description: "Stop id to start from.",
        //                 schema: { type: "string", format: "uuid" },
        //             },
        //             {
        //                 name: "to",
        //                 in: "query",
        //                 required: true,
        //                 description: "Destination stop id.",
        //                 schema: { type: "string", format: "uuid" },
        //             },
        //         ],
        //         responses: {
        //             "200": {
        //                 description: "Path found.",
        //                 content: {
        //                     "application/json": {
        //                         schema: {
        //                             type: "object",
        //                             required: ["alternativesAvailable", "best"],
        //                             properties: {
        //                                 alternativesAvailable: {
        //                                     type: "boolean",
        //                                     description:
        //                                         "true when lessWalking and lessTransit found genuinely different " +
        //                                         "routes (both are then included alongside best); false when they " +
        //                                         "agree or only one exists (only best is included).",
        //                                 },
        //                                 best: { $ref: "#/components/schemas/AstarResult" },
        //                                 lessWalking: { $ref: "#/components/schemas/AstarResult" },
        //                                 lessTransit: { $ref: "#/components/schemas/AstarResult" },
        //                             },
        //                         },
        //                         example: {
        //                             alternativesAvailable: false,
        //                             best: {
        //                                 path: [
        //                                     {
        //                                         stopId: "cd2cca12-9be9-5328-b476-4ea7e0cc7c08",
        //                                         name: "BNDCC",
        //                                         via: {
        //                                             to: "93b36a0c-2327-57ca-9d81-8c7936519a60",
        //                                             weight: 76.06,
        //                                             distanceMeters: 422.56,
        //                                             kind: "ride",
        //                                             routeId: "0377a5c0-3000-5ff0-b55f-56467e93b3e2",
        //                                             inVehicleTime: 76.06,
        //                                             walkingTime: 0,
        //                                             waitingTime: 0,
        //                                         },
        //                                     },
        //                                     {
        //                                         stopId: "93b36a0c-2327-57ca-9d81-8c7936519a60",
        //                                         name: "Renon",
        //                                         via: null,
        //                                     },
        //                                 ],
        //                                 cost: {
        //                                     inVehicleTime: 76.06,
        //                                     walkingTime: 0,
        //                                     waitingTime: 510,
        //                                     numTransfers: 0,
        //                                     totalSeconds: 586.06,
        //                                     weightedCost: 841.15,
        //                                 },
        //                                 steps: [{ type: "ride", routeRef: "K1B", routeName: "Kuta - Batubulan", durationMinutes: 1 }],
        //                             },
        //                         },
        //                     },
        //                 },
        //             },
        //             "400": {
        //                 description: "Missing `from` or `to` query parameter.",
        //                 content: {
        //                     "application/json": {
        //                         schema: {
        //                             type: "object",
        //                             properties: { error: { type: "string" } },
        //                         },
        //                         example: { error: "Invalid arguments" },
        //                     },
        //                 },
        //             },
        //             "404": {
        //                 description: "One of the stop ids is unknown, or no route exists between them under either profile.",
        //                 content: {
        //                     "application/json": {
        //                         schema: {
        //                             type: "object",
        //                             properties: { error: { type: "string" } },
        //                         },
        //                         examples: {
        //                             unknownStop: { value: { error: "Unknown stop id" } },
        //                             noRoute: { value: { error: "No route found" } },
        //                         },
        //                     },
        //                 },
        //             },
        //         },
        //     },
        // },
        "/journey/overview": {
            get: {
                summary: "Plan a door-to-door journey between two coordinates, less-walking and less-transit alike",
                description:
                    "Finds a journey from an arbitrary origin to an arbitrary destination coordinate, combining " +
                    "real walking directions (via Apple Maps) with transit routing over the bus graph — once " +
                    "optimised for less walking and once for fewer transfers.\n\n" +
                    "Candidate boarding/alighting stops near the origin/destination are searched pairwise and " +
                    "ranked by the same weighted cost each profile uses elsewhere. If walking the whole way is " +
                    "short enough and no slower than transit, the journey is a single walk segment instead " +
                    "(`segments` then has one `walk` entry and `summary.busLegCount` is 0).\n\n" +
                    alternativesEnvelopeDescription,
                parameters: [
                    {
                        name: "origin",
                        in: "query",
                        required: true,
                        description: "Starting coordinate as `lat,lng`.",
                        schema: { type: "string" },
                        example: "-8.6705,115.2126",
                    },
                    {
                        name: "destination",
                        in: "query",
                        required: true,
                        description: "Destination coordinate as `lat,lng`.",
                        schema: { type: "string" },
                        example: "-8.7089,115.2537",
                    },
                ],
                responses: {
                    "200": {
                        description: "Journey found.",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    required: ["alternativesAvailable", "best"],
                                    properties: {
                                        alternativesAvailable: {
                                            type: "boolean",
                                            description:
                                                "true when lessWalking and lessTransit found genuinely different " +
                                                "journeys (both are then included alongside best); false when " +
                                                "they agree or only one exists (only best is included).",
                                        },
                                        best: { $ref: "#/components/schemas/JourneyResult" },
                                        lessWalking: { $ref: "#/components/schemas/JourneyResult" },
                                        lessTransit: { $ref: "#/components/schemas/JourneyResult" },
                                    },
                                },
                            },
                        },
                    },
                    "400": {
                        description: "Missing or invalid `origin`/`destination` query parameter.",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: { error: { type: "string" } },
                                },
                                example: { error: "Invalid arguments" },
                            },
                        },
                    },
                    "404": {
                        description: "No stops are configured, no journey could be found under either profile, or Apple Maps returned no walking directions for a required leg.",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: { error: { type: "string" } },
                                },
                                examples: {
                                    noStops: { value: { error: "No stops available" } },
                                    noRoute: { value: { error: "No route found" } },
                                    noWalkToStop: { value: { error: "No walking route to boarding stop" } },
                                    noWalkFromStop: { value: { error: "No walking route from alighting stop" } },
                                },
                            },
                        },
                    },
                },
            },
        },
        "/quest": {
            get: {
                tags: ["Quest"],
                summary: "List quests",
                description: "Returns every quest with its thumbnail media.",
                responses: {
                    "200": {
                        description: "Quests found.",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    required: ["quests"],
                                    properties: { quests: { type: "array", items: { $ref: "#/components/schemas/Quest" } } },
                                },
                            },
                        },
                    },
                },
            },
            // post: {
            //     tags: ["Quest"],
            //     summary: "Create a quest",
            //     requestBody: {
            //         required: true,
            //         content: {
            //             "application/json": {
            //                 schema: {
            //                     type: "object",
            //                     required: ["name", "category", "description"],
            //                     properties: {
            //                         name: { type: "string" },
            //                         category: { type: "string" },
            //                         description: { type: "string" },
            //                     },
            //                 },
            //             },
            //         },
            //     },
            //     responses: {
            //         "201": {
            //             description: "Quest created, with an empty `thumbnails` array.",
            //             content: {
            //                 "application/json": {
            //                     schema: { type: "object", required: ["quest"], properties: { quest: { $ref: "#/components/schemas/Quest" } } },
            //                 },
            //             },
            //         },
            //         "400": {
            //             description: "Missing or invalid `name`/`category`/`description`.",
            //             content: {
            //                 "application/json": {
            //                     schema: { type: "object", properties: { error: { type: "string" } } },
            //                     example: { error: "Invalid arguments" },
            //                 },
            //             },
            //         },
            //     },
            // },
        },
        "/quest/{id}": {
            get: {
                tags: ["Quest"],
                summary: "Get a quest",
                description:
                    "Returns a quest with its thumbnails, attached badges (each with its ordered steps), and " +
                    "`origin`/`destination` — the first and last badge step (in attachment order) that has a " +
                    "lat/lng set. Pass those straight to /journey/overview to preview the quest's route.",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
                responses: {
                    "200": {
                        description: "Quest found.",
                        content: {
                            "application/json": {
                                schema: { type: "object", required: ["quest"], properties: { quest: { $ref: "#/components/schemas/QuestDetail" } } },
                                example: {
                                    quest: {
                                        id: "6b1f7a2a-2f2e-4c2a-9b0a-1e2d3c4b5a6f",
                                        name: "Sanur Street",
                                        category: "Beaches",
                                        description: "Where earlybirds relax",
                                        thumbnails: [],
                                        badges: [
                                            {
                                                id: "6fb84e99-5404-4c1a-b320-1fb027fbfc51",
                                                badgeId: "b0564b3e-4fb4-4790-82f6-ff820dbe5f8b",
                                                badgeName: "Sanoored",
                                                badgeCategory: "Explore",
                                                badgeType: "quest",
                                                badgeImageUrl: null,
                                                steps: [
                                                    {
                                                        id: "57585fca-523c-47fc-8db7-f3d0e408dff7",
                                                        badgeId: "b0564b3e-4fb4-4790-82f6-ff820dbe5f8b",
                                                        actionId: "02115d76-7951-44d4-a2e5-a62bfc37dcfc",
                                                        actionName: "Walk",
                                                        actionType: "required",
                                                        sequence: 1,
                                                        lat: -8.6788,
                                                        lng: 115.2622,
                                                        instruction: "Walk to Taman Kencana",
                                                    },
                                                    {
                                                        id: "c5f26f71-9166-4122-a6b0-9930e1ef8225",
                                                        badgeId: "b0564b3e-4fb4-4790-82f6-ff820dbe5f8b",
                                                        actionId: "c06478e1-650d-4eee-a55b-41009cd0878e",
                                                        actionName: "Take Picture",
                                                        actionType: "optional",
                                                        sequence: 2,
                                                        lat: -8.6705,
                                                        lng: 115.2646,
                                                        instruction: null,
                                                    },
                                                ],
                                            },
                                        ],
                                        origin: { lat: -8.6788, lng: 115.2622 },
                                        destination: { lat: -8.6705, lng: 115.2646 },
                                    },
                                },
                            },
                        },
                    },
                    "404": {
                        description: "No quest with this id.",
                        content: {
                            "application/json": {
                                schema: { type: "object", properties: { error: { type: "string" } } },
                                example: { error: "Quest not found" },
                            },
                        },
                    },
                },
            },
            // patch: {
            //     tags: ["Quest"],
            //     summary: "Update a quest",
            //     description: "Body may include any of `name`/`category`/`description`. Returns the same shape as GET.",
            //     parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
            //     requestBody: {
            //         required: true,
            //         content: {
            //             "application/json": {
            //                 schema: {
            //                     type: "object",
            //                     properties: {
            //                         name: { type: "string" },
            //                         category: { type: "string" },
            //                         description: { type: "string" },
            //                     },
            //                 },
            //             },
            //         },
            //     },
            //     responses: {
            //         "200": {
            //             description: "Quest updated.",
            //             content: {
            //                 "application/json": {
            //                     schema: { type: "object", required: ["quest"], properties: { quest: { $ref: "#/components/schemas/QuestDetail" } } },
            //                 },
            //             },
            //         },
            //         "400": {
            //             description: "No updatable fields provided, or one provided as an invalid value.",
            //             content: {
            //                 "application/json": {
            //                     schema: { type: "object", properties: { error: { type: "string" } } },
            //                     examples: {
            //                         invalid: { value: { error: "Invalid arguments" } },
            //                         empty: { value: { error: "No fields to update" } },
            //                     },
            //                 },
            //             },
            //         },
            //         "404": {
            //             description: "No quest with this id.",
            //             content: {
            //                 "application/json": {
            //                     schema: { type: "object", properties: { error: { type: "string" } } },
            //                     example: { error: "Quest not found" },
            //                 },
            //             },
            //         },
            //     },
            // },
            // delete: {
            //     tags: ["Quest"],
            //     summary: "Delete a quest",
            //     description:
            //         "Deletes the quest, its QuestMedia/QuestBadge links, and any thumbnails no longer used elsewhere.",
            //     parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
            //     responses: {
            //         "204": { description: "Quest deleted." },
            //         "404": {
            //             description: "No quest with this id.",
            //             content: {
            //                 "application/json": {
            //                     schema: { type: "object", properties: { error: { type: "string" } } },
            //                     example: { error: "Quest not found" },
            //                 },
            //             },
            //         },
            //     },
            // },
        },
        "/quest/{id}/badges": {
            get: {
                tags: ["Quest"],
                summary: "List a quest's badges",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
                responses: {
                    "200": {
                        description: "Badges attached to this quest.",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    required: ["questBadges"],
                                    properties: { questBadges: { type: "array", items: { $ref: "#/components/schemas/QuestBadgeEntry" } } },
                                },
                            },
                        },
                    },
                    "404": {
                        description: "No quest with this id.",
                        content: {
                            "application/json": {
                                schema: { type: "object", properties: { error: { type: "string" } } },
                                example: { error: "Quest not found" },
                            },
                        },
                    },
                },
            },
            // post: {
            //     tags: ["Quest"],
            //     summary: "Attach a badge to a quest",
            //     parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
            //     requestBody: {
            //         required: true,
            //         content: {
            //             "application/json": {
            //                 schema: { type: "object", required: ["badgeId"], properties: { badgeId: { type: "string", format: "uuid" } } },
            //             },
            //         },
            //     },
            //     responses: {
            //         "201": {
            //             description: "Badge attached.",
            //             content: {
            //                 "application/json": {
            //                     schema: { type: "object", required: ["questBadge"], properties: { questBadge: { $ref: "#/components/schemas/QuestBadgeEntry" } } },
            //                 },
            //             },
            //         },
            //         "400": {
            //             description: "Missing or invalid `badgeId`.",
            //             content: {
            //                 "application/json": {
            //                     schema: { type: "object", properties: { error: { type: "string" } } },
            //                     example: { error: "Invalid badgeId" },
            //                 },
            //             },
            //         },
            //         "404": {
            //             description: "No quest or badge with this id.",
            //             content: {
            //                 "application/json": {
            //                     schema: { type: "object", properties: { error: { type: "string" } } },
            //                     examples: {
            //                         quest: { value: { error: "Quest not found" } },
            //                         badge: { value: { error: "Badge not found" } },
            //                     },
            //                 },
            //             },
            //         },
            //         "409": {
            //             description: "This badge is already attached to this quest.",
            //             content: {
            //                 "application/json": {
            //                     schema: { type: "object", properties: { error: { type: "string" } } },
            //                     example: { error: "This badge is already attached to this quest" },
            //                 },
            //             },
            //         },
            //     },
            // },
        },
        // "/quest/{id}/badges/{badgeId}": {
        //     delete: {
        //         tags: ["Quest"],
        //         summary: "Detach a badge from a quest",
        //         parameters: [
        //             { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        //             { name: "badgeId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        //         ],
        //         responses: {
        //             "204": { description: "Badge detached." },
        //             "404": {
        //                 description: "This badge is not attached to this quest.",
        //                 content: {
        //                     "application/json": {
        //                         schema: { type: "object", properties: { error: { type: "string" } } },
        //                         example: { error: "This badge is not attached to this quest" },
        //                     },
        //                 },
        //             },
        //         },
        //     },
        // },
        // "/quest/media": {
        //     post: {
        //         tags: ["Quest"],
        //         summary: "Upload a quest thumbnail",
        //         description:
        //             "Uploads a thumbnail image to R2 and links it to a quest. Accepts image/png, image/jpeg, " +
        //             "image/webp, or image/gif up to 8 MB.",
        //         requestBody: {
        //             required: true,
        //             content: {
        //                 "multipart/form-data": {
        //                     schema: {
        //                         type: "object",
        //                         required: ["questId", "file"],
        //                         properties: {
        //                             questId: { type: "string", format: "uuid" },
        //                             file: { type: "string", format: "binary" },
        //                         },
        //                     },
        //                 },
        //             },
        //         },
        //         responses: {
        //             "201": {
        //                 description: "Thumbnail uploaded and linked.",
        //                 content: {
        //                     "application/json": {
        //                         schema: { type: "object", required: ["media"], properties: { media: { $ref: "#/components/schemas/MediaAsset" } } },
        //                     },
        //                 },
        //             },
        //             "400": {
        //                 description: "Missing `questId`/`file`, or the file is an unsupported type or too large.",
        //                 content: {
        //                     "application/json": {
        //                         schema: { type: "object", properties: { error: { type: "string" } } },
        //                         examples: {
        //                             missingQuestId: { value: { error: "Missing questId" } },
        //                             missingFile: { value: { error: "Missing file" } },
        //                             unsupportedType: { value: { error: "Unsupported file type" } },
        //                             tooLarge: { value: { error: "File too large" } },
        //                         },
        //                     },
        //                 },
        //             },
        //             "404": {
        //                 description: "No quest with this id.",
        //                 content: {
        //                     "application/json": {
        //                         schema: { type: "object", properties: { error: { type: "string" } } },
        //                         example: { error: "Quest not found" },
        //                     },
        //                 },
        //             },
        //         },
        //     },
        //     delete: {
        //         tags: ["Quest"],
        //         summary: "Detach a quest thumbnail",
        //         description: "Detaches a thumbnail from a quest, deleting the underlying file if no other quest uses it.",
        //         parameters: [
        //             { name: "questId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
        //             { name: "mediaId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
        //         ],
        //         responses: {
        //             "204": { description: "Thumbnail detached." },
        //             "400": {
        //                 description: "Missing `questId` or `mediaId`.",
        //                 content: {
        //                     "application/json": {
        //                         schema: { type: "object", properties: { error: { type: "string" } } },
        //                         example: { error: "Missing questId or mediaId" },
        //                     },
        //                 },
        //             },
        //             "404": {
        //                 description: "No thumbnail link for this questId/mediaId pair.",
        //                 content: {
        //                     "application/json": {
        //                         schema: { type: "object", properties: { error: { type: "string" } } },
        //                         example: { error: "Thumbnail not found" },
        //                     },
        //                 },
        //             },
        //         },
        //     },
        // },
        "/kelurahan/quests": {
            get: {
                tags: ["Quest"],
                summary: "List quests grouped by kelurahan",
                description:
                    "Returns each kelurahan that has at least one reachable quest (a quest with a badge scoped " +
                    "to it via Badge.kelurahanId), paired with those quests. Kelurahans with no quests are " +
                    "omitted. A quest can appear under more than one kelurahan if its badges span several.",
                responses: {
                    "200": {
                        description: "Groups found.",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    required: ["groups"],
                                    properties: {
                                        groups: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                required: ["kelurahan", "quests"],
                                                properties: {
                                                    kelurahan: { $ref: "#/components/schemas/Kelurahan" },
                                                    quests: { type: "array", items: { $ref: "#/components/schemas/Quest" } },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        "/kelurahan/{id}/quests": {
            get: {
                tags: ["Quest"],
                summary: "List a kelurahan's quests",
                description:
                    "Returns the quests reachable in this kelurahan (quests with at least one badge scoped to " +
                    "it), each with its thumbnails and all of its attached badges.",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
                responses: {
                    "200": {
                        description: "Kelurahan and its quests.",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    required: ["kelurahan", "quests"],
                                    properties: {
                                        kelurahan: { $ref: "#/components/schemas/Kelurahan" },
                                        quests: { type: "array", items: { $ref: "#/components/schemas/QuestWithBadges" } },
                                    },
                                },
                            },
                        },
                    },
                    "404": {
                        description: "No kelurahan with this id.",
                        content: {
                            "application/json": {
                                schema: { type: "object", properties: { error: { type: "string" } } },
                                example: { error: "Kelurahan not found" },
                            },
                        },
                    },
                },
            },
        },
        // "/maps/route": {
        //     get: {
        //         summary: "Get directions between two coordinates via Apple Maps",
        //         description:
        //             "Proxies Apple Maps' Directions API for a raw origin/destination pair (not bus stops — " +
        //             "see `/journey/overview` for door-to-door transit routing, or `/astar` for stop-to-stop routing).",
        //         parameters: [
        //             {
        //                 name: "origin",
        //                 in: "query",
        //                 required: true,
        //                 description: "Starting coordinate as `lat,lng`.",
        //                 schema: { type: "string" },
        //                 example: "-8.6705,115.2126",
        //             },
        //             {
        //                 name: "destination",
        //                 in: "query",
        //                 required: true,
        //                 description: "Destination coordinate as `lat,lng`.",
        //                 schema: { type: "string" },
        //                 example: "-8.7089,115.2537",
        //             },
        //             {
        //                 name: "transportType",
        //                 in: "query",
        //                 required: false,
        //                 description: "Mode of travel. Defaults to `driving`.",
        //                 schema: {
        //                     type: "string",
        //                     enum: ["driving", "walking", "cycling"],
        //                     default: "driving",
        //                 },
        //             },
        //         ],
        //         responses: {
        //             "200": {
        //                 description: "Route found.",
        //                 content: {
        //                     "application/json": {
        //                         schema: {
        //                             type: "object",
        //                             required: ["geometry", "steps"],
        //                             properties: {
        //                                 distanceMeters: { type: "number" },
        //                                 durationSeconds: { type: "number" },
        //                                 geometry: {
        //                                     type: "array",
        //                                     description: "The whole route as [lng, lat] pairs.",
        //                                     items: {
        //                                         type: "array",
        //                                         items: { type: "number" },
        //                                         minItems: 2,
        //                                         maxItems: 2,
        //                                     },
        //                                 },
        //                                 steps: {
        //                                     type: "array",
        //                                     items: {
        //                                         type: "object",
        //                                         properties: {
        //                                             instructions: { type: "string" },
        //                                             distanceMeters: { type: "number" },
        //                                             durationSeconds: { type: "number" },
        //                                             geometry: {
        //                                                 type: "array",
        //                                                 items: {
        //                                                     type: "array",
        //                                                     items: { type: "number" },
        //                                                     minItems: 2,
        //                                                     maxItems: 2,
        //                                                 },
        //                                             },
        //                                         },
        //                                     },
        //                                 },
        //                             },
        //                         },
        //                     },
        //                 },
        //             },
        //             "400": {
        //                 description: "Missing or invalid `origin`/`destination`/`transportType`.",
        //                 content: {
        //                     "application/json": {
        //                         schema: {
        //                             type: "object",
        //                             properties: { error: { type: "string" } },
        //                         },
        //                         example: { error: "Invalid arguments" },
        //                     },
        //                 },
        //             },
        //             "404": {
        //                 description: "Apple Maps returned no route.",
        //                 content: {
        //                     "application/json": {
        //                         schema: {
        //                             type: "object",
        //                             properties: { error: { type: "string" } },
        //                         },
        //                         example: { error: "No route found" },
        //                     },
        //                 },
        //             },
        //         },
        //     },
        // },
    },
} as const
