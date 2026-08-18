// OpenAPI document describing the public HTTP API. Served as JSON at
// /api/openapi.json and rendered by Scalar at /reference.
//
// Only documents /api/astar, /api/journey/overview, and /api/maps/route for now —
// add other paths here as they get documented.

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
