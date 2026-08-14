import type { StyleSpecification } from "maplibre-gl"

export const BASEMAP_PMTILES_URL = "/tiles/bali-basemap.pmtiles"
export const TRANSIT_PMTILES_URL = "/tiles/bali-transit.pmtiles"

// Bounds and center pulled from each file's pmtiles header.
export const BASEMAP_BOUNDS: [number, number, number, number] = [
    114.431564, -8.850025, 115.711499, -8.061589,
]
export const TRANSIT_BOUNDS: [number, number, number, number] = [
    115.110815, -8.809218, 115.284645, -8.506872,
]

export const transitMapStyle: StyleSpecification = {
    version: 8,
    sources: {
        basemap: {
            type: "vector",
            url: `pmtiles://${BASEMAP_PMTILES_URL}`,
        },
        transit: {
            type: "vector",
            url: `pmtiles://${TRANSIT_PMTILES_URL}`,
        },
        "active-route": {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
        },
        "active-stops": {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
        },
    },
    layers: [
        {
            id: "background",
            type: "background",
            paint: { "background-color": "#eef1ec" },
        },
        {
            id: "land",
            type: "fill",
            source: "basemap",
            "source-layer": "land",
            paint: { "fill-color": "#e2e7d8" },
        },
        {
            id: "roads",
            type: "line",
            source: "basemap",
            "source-layer": "roads",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
                "line-color": [
                    "match",
                    ["get", "highway"],
                    ["motorway", "trunk"],
                    "#f2b04c",
                    ["primary"],
                    "#f8d878",
                    ["secondary", "tertiary"],
                    "#ffffff",
                    "#dcdcd6",
                ],
                "line-width": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    6,
                    ["match", ["get", "highway"], ["motorway", "trunk"], 1, 0.4],
                    14,
                    [
                        "match",
                        ["get", "highway"],
                        ["motorway", "trunk"],
                        6,
                        ["primary"],
                        4,
                        ["secondary", "tertiary"],
                        3,
                        1.5,
                    ],
                ],
            },
        },
        {
            id: "bus-routes",
            type: "line",
            source: "transit",
            "source-layer": "bus_routes",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
                "line-color": ["coalesce", ["get", "colour"], "#2d4c9c"],
                "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 14, 4],
                "line-opacity": 0.85,
            },
        },
        {
            id: "bus-stops",
            type: "circle",
            source: "transit",
            "source-layer": "bus_stops",
            filter: ["==", ["get", "highway"], "bus_stop"],
            paint: {
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2, 16, 6],
                "circle-color": "#e52522",
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 1.5,
            },
        },
        {
            id: "active-route-transfer",
            type: "line",
            source: "active-route",
            filter: ["==", ["get", "kind"], "transfer"],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
                "line-color": "#1a1a1a",
                "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 14, 4],
                "line-dasharray": [1, 1.5],
                "line-opacity": 0.9,
            },
        },
        {
            id: "active-route-ride",
            type: "line",
            source: "active-route",
            filter: ["==", ["get", "kind"], "ride"],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
                "line-color": "#1a1a1a",
                "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 7],
                "line-opacity": 0.9,
            },
        },
        {
            id: "active-stops",
            type: "circle",
            source: "active-stops",
            paint: {
                "circle-radius": 8,
                "circle-color": ["match", ["get", "role"], "from", "#1a9e4c", "#e5252f"],
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 2,
            },
        },
    ],
}
