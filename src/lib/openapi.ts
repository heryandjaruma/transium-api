// OpenAPI document describing the public HTTP API. Served as JSON at
// /api/openapi.json and rendered by Scalar at /reference.
//
// Only documents /api/route and /api/maps/route for now — add other paths
// here as they get documented.
export const openApiSpec = {
    openapi: "3.1.0",
    info: {
        title: "Transium API",
        version: "0.1.0",
        description: "Public transit routing API for Bali.",
    },
    servers: [{ url: "/api" }],
    paths: {
        "/route": {
            get: {
                summary: "Find a route between two stops",
                description:
                    "Computes the shortest path between two bus stops with A* search over the transit graph. " +
                    "Each entry in `path` is a stop; its `via` field describes the edge taken from that stop to the " +
                    "next one (`ride` along a bus route, or `transfer` on foot between nearby stops). The final " +
                    "stop's `via` is `null`.",
                parameters: [
                    {
                        name: "from",
                        in: "query",
                        required: true,
                        description: "Stop id to start from.",
                        schema: { type: "string", format: "uuid" },
                    },
                    {
                        name: "to",
                        in: "query",
                        required: true,
                        description: "Destination stop id.",
                        schema: { type: "string", format: "uuid" },
                    },
                ],
                responses: {
                    "200": {
                        description: "Path found.",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    required: ["path"],
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
                                                                required: ["to", "weight", "kind"],
                                                                properties: {
                                                                    to: {
                                                                        type: "string",
                                                                        format: "uuid",
                                                                        description: "Stop id this edge leads to.",
                                                                    },
                                                                    weight: {
                                                                        type: "number",
                                                                        description:
                                                                            "Edge cost in meters (haversine distance, plus a fixed penalty when kind is transfer).",
                                                                    },
                                                                    kind: {
                                                                        type: "string",
                                                                        enum: ["ride", "transfer"],
                                                                    },
                                                                    routeId: {
                                                                        type: "string",
                                                                        format: "uuid",
                                                                        description: "Present when kind is ride.",
                                                                    },
                                                                },
                                                            },
                                                            { type: "null" },
                                                        ],
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                                example: {
                                    path: [
                                        {
                                            stopId: "cd2cca12-9be9-5328-b476-4ea7e0cc7c08",
                                            name: "BNDCC",
                                            via: {
                                                to: "93b36a0c-2327-57ca-9d81-8c7936519a60",
                                                weight: 422.56358299014215,
                                                kind: "ride",
                                                routeId: "0377a5c0-3000-5ff0-b55f-56467e93b3e2",
                                            },
                                        },
                                        {
                                            stopId: "93b36a0c-2327-57ca-9d81-8c7936519a60",
                                            name: "Renon",
                                            via: null,
                                        },
                                    ],
                                },
                            },
                        },
                    },
                    "400": {
                        description: "Missing `from` or `to` query parameter.",
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
                        description: "One of the stop ids is unknown, or no route exists between them.",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: { error: { type: "string" } },
                                },
                                examples: {
                                    unknownStop: { value: { error: "Unknown stop id" } },
                                    noRoute: { value: { error: "No route found" } },
                                },
                            },
                        },
                    },
                },
            },
        },
        "/maps/route": {
            get: {
                summary: "Get directions between two coordinates via Apple Maps",
                description:
                    "Proxies Apple Maps' Directions API for a raw origin/destination pair (not bus stops — " +
                    "see `/route` for stop-to-stop transit routing). Returns the first route Apple suggests.",
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
                    {
                        name: "transportType",
                        in: "query",
                        required: false,
                        description: "Mode of travel. Defaults to `driving`.",
                        schema: {
                            type: "string",
                            enum: ["driving", "walking", "cycling"],
                            default: "driving",
                        },
                    },
                ],
                responses: {
                    "200": {
                        description: "Route found.",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    required: ["geometry", "steps"],
                                    properties: {
                                        distanceMeters: { type: "number" },
                                        durationSeconds: { type: "number" },
                                        geometry: {
                                            type: "array",
                                            description: "The whole route as [lng, lat] pairs.",
                                            items: {
                                                type: "array",
                                                items: { type: "number" },
                                                minItems: 2,
                                                maxItems: 2,
                                            },
                                        },
                                        steps: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    instructions: { type: "string" },
                                                    distanceMeters: { type: "number" },
                                                    durationSeconds: { type: "number" },
                                                    geometry: {
                                                        type: "array",
                                                        items: {
                                                            type: "array",
                                                            items: { type: "number" },
                                                            minItems: 2,
                                                            maxItems: 2,
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
                    "400": {
                        description: "Missing or invalid `origin`/`destination`/`transportType`.",
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
                        description: "Apple Maps returned no route.",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: { error: { type: "string" } },
                                },
                                example: { error: "No route found" },
                            },
                        },
                    },
                },
            },
        },
    },
} as const
