"use client"

import { useEffect, useRef, useState } from "react"
import {
    Map as MaplibreMap,
    NavigationControl,
    Popup,
    addProtocol,
    setWorkerUrl,
    type GeoJSONSource,
    type MapLayerMouseEvent,
} from "maplibre-gl"
import { Protocol } from "pmtiles"
import "maplibre-gl/dist/maplibre-gl.css"

import {
    BASEMAP_BOUNDS,
    TRANSIT_BOUNDS,
    transitMapStyle,
} from "@/components/map/transit-map-style"
import { haversine } from "@/lib/bus-graph"

let pmtilesProtocolRegistered = false

function ensurePmtilesProtocol() {
    if (pmtilesProtocolRegistered) return
    const protocol = new Protocol()
    addProtocol("pmtiles", protocol.tile)
    // Turbopack/webpack can't statically rewrite maplibre's internal
    // `new Worker(new URL(...))` call, so the auto-detected worker URL
    // resolves to the current page instead of the worker script and tile
    // loading hangs forever. Point it at a static copy instead.
    setWorkerUrl("/maplibre-gl-worker.mjs")
    pmtilesProtocolRegistered = true
}

const INTERACTIVE_LAYER_IDS = ["bus-stops", "bus-routes"]

type Stop = { id: string; stopId: string; name: string; lat: number; lng: number }
type RouteLeg = { via: { kind: "ride" | "transfer"; geometry: [number, number][] } | null }

export function TransitMap() {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const [status, setStatus] = useState("Click a stop to set your departure")

    useEffect(() => {
        if (!containerRef.current) return

        ensurePmtilesProtocol()

        const map = new MaplibreMap({
            container: containerRef.current,
            style: transitMapStyle,
            bounds: TRANSIT_BOUNDS,
            fitBoundsOptions: { padding: 40 },
            maxBounds: [
                [BASEMAP_BOUNDS[0] - 0.2, BASEMAP_BOUNDS[1] - 0.2],
                [BASEMAP_BOUNDS[2] + 0.2, BASEMAP_BOUNDS[3] + 0.2],
            ],
        })

        map.addControl(new NavigationControl(), "top-right")

        map.on("error", (e) => {
            console.error("MapLibre error:", e.error)
        })

        // The deployed transit vector tiles were built from a raw OSM export
        // that predates the stop_id enrichment in the gpkg/D1, so tile
        // features carry no id that lines up with BusStop. Match by nearest
        // coordinate instead — both sources trace back to the same OSM nodes.
        const NEAREST_STOP_MAX_METERS = 50
        let allStops: Stop[] = []
        let fromStop: Stop | null = null

        fetch("/api/stops")
            .then((r) => r.json() as Promise<{ stops: Stop[] }>)
            .then((data) => {
                allStops = data.stops
            })
            .catch((err) => console.error("Failed to load stops:", err))

        const nearestStop = (lng: number, lat: number): Stop | null => {
            let best: Stop | null = null
            let bestDist = Infinity
            for (const s of allStops) {
                const d = haversine({ lat, lng }, { lat: s.lat, lng: s.lng })
                if (d < bestDist) {
                    bestDist = d
                    best = s
                }
            }
            return bestDist <= NEAREST_STOP_MAX_METERS ? best : null
        }

        const setActiveStops = (stops: Stop[]) => {
            const source = map.getSource("active-stops") as GeoJSONSource | undefined
            source?.setData({
                type: "FeatureCollection",
                features: stops.map((s, i) => ({
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [s.lng, s.lat] },
                    properties: { role: i === 0 ? "from" : "to" },
                })),
            })
        }

        const setActiveRoute = (legs: RouteLeg[]) => {
            const source = map.getSource("active-route") as GeoJSONSource | undefined
            source?.setData({
                type: "FeatureCollection",
                features: legs
                    .filter((leg): leg is RouteLeg & { via: NonNullable<RouteLeg["via"]> } => leg.via !== null)
                    .map((leg) => ({
                        type: "Feature",
                        geometry: { type: "LineString", coordinates: leg.via.geometry },
                        properties: { kind: leg.via.kind },
                    })),
            })
        }

        const popup = new Popup({ closeButton: false, closeOnClick: true })

        const handleRouteLineClick = (e: MapLayerMouseEvent) => {
            const feature = e.features?.[0]
            if (!feature) return

            const name = typeof feature.properties?.name === "string" ? feature.properties.name : "Unnamed"
            const ref = typeof feature.properties?.ref === "string" ? feature.properties.ref : undefined

            const content = document.createElement("div")
            content.className = "text-sm"
            const title = document.createElement("strong")
            title.textContent = name
            content.appendChild(title)
            if (ref) {
                const refEl = document.createElement("span")
                refEl.textContent = ` (${ref})`
                content.appendChild(refEl)
            }

            popup.setLngLat(e.lngLat).setDOMContent(content).addTo(map)
        }

        const handleStopClick = async (e: MapLayerMouseEvent) => {
            const geometry = e.features?.[0]?.geometry
            if (!geometry || geometry.type !== "Point") return
            const [lng, lat] = geometry.coordinates
            const stop = nearestStop(lng, lat)
            if (!stop) return

            if (!fromStop) {
                fromStop = stop
                setActiveStops([stop])
                setActiveRoute([])
                setStatus(`Departure: ${stop.name} — click another stop for arrival`)
                return
            }

            if (stop.id === fromStop.id) return

            const from = fromStop
            fromStop = null
            setActiveStops([from, stop])
            setStatus(`Finding route from ${from.name} to ${stop.name}…`)

            try {
                const res = await fetch(`/api/route?from=${from.id}&to=${stop.id}`)
                const data = (await res.json()) as { path?: RouteLeg[]; error?: string }
                if (!res.ok || !data.path) {
                    setStatus(data.error ?? "No route found")
                    return
                }
                setActiveRoute(data.path)
                setStatus(`${from.name} → ${stop.name} — click a stop to start over`)
            } catch (err) {
                console.error("Failed to fetch route:", err)
                setStatus("Failed to fetch route")
            }
        }

        const handleMouseEnter = () => {
            map.getCanvas().style.cursor = "pointer"
        }
        const handleMouseLeave = () => {
            map.getCanvas().style.cursor = ""
        }

        map.on("click", "bus-stops", handleStopClick)
        map.on("click", "bus-routes", handleRouteLineClick)
        for (const layerId of INTERACTIVE_LAYER_IDS) {
            map.on("mouseenter", layerId, handleMouseEnter)
            map.on("mouseleave", layerId, handleMouseLeave)
        }

        return () => {
            map.remove()
        }
    }, [])

    return (
        <div className="relative h-full w-full">
            <div ref={containerRef} className="h-full w-full" />
            <div className="pointer-events-none absolute left-3 top-3 rounded bg-white/90 px-3 py-1.5 text-sm shadow">
                {status}
            </div>
        </div>
    )
}
