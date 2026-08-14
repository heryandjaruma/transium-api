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
import { JourneyPanel } from "@/components/map/journey-panel"
import type { JourneyOverview, JourneySegment, LatLng } from "@/lib/journey"

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

const ROUTE_LINE_LAYER_IDS = ["bus-routes"]

type ActivePoint = { lng: number; lat: number; role: "origin" | "destination" | "stop" }

/** Every stop this segment touches, so intermediate board/alight/transfer points get pinned too. */
function segmentStopPoints(segment: JourneySegment): { stopId: string; lat: number; lng: number }[] {
    if (segment.type === "walk") {
        return [segment.from, segment.to].filter(
            (p): p is typeof p & { stopId: string } => typeof p.stopId === "string"
        )
    }
    return [segment.from, segment.to]
}

export function TransitMap() {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const [status, setStatus] = useState("Click the map to set your departure point")
    const [journey, setJourney] = useState<JourneyOverview | null>(null)
    const resetRef = useRef<() => void>(() => {})

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
        map.on("load", () => {
            map.getCanvas().style.cursor = "crosshair"
        })

        let origin: LatLng | null = null
        let destination: LatLng | null = null
        let requestId = 0

        const setActivePoints = (points: ActivePoint[]) => {
            const source = map.getSource("active-stops") as GeoJSONSource | undefined
            source?.setData({
                type: "FeatureCollection",
                features: points.map((p) => ({
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [p.lng, p.lat] },
                    properties: { role: p.role },
                })),
            })
        }

        const setActiveRoute = (segments: JourneySegment[]) => {
            const source = map.getSource("active-route") as GeoJSONSource | undefined
            source?.setData({
                type: "FeatureCollection",
                features: segments.map((seg) => ({
                    type: "Feature",
                    geometry: { type: "LineString", coordinates: seg.geometry },
                    properties: {
                        kind: seg.type,
                        color: seg.type === "bus" ? seg.routeColor ?? "#1a1a1a" : undefined,
                    },
                })),
            })
        }

        const renderJourney = (j: JourneyOverview) => {
            setActiveRoute(j.segments)

            const points = new Map<string, ActivePoint>()
            for (const segment of j.segments) {
                for (const stop of segmentStopPoints(segment)) {
                    if (!points.has(stop.stopId)) {
                        points.set(stop.stopId, { lng: stop.lng, lat: stop.lat, role: "stop" })
                    }
                }
            }
            // Origin/destination pins always win over a same-spot stop pin.
            points.set("__origin", { lng: j.origin.lng, lat: j.origin.lat, role: "origin" })
            points.set("__destination", { lng: j.destination.lng, lat: j.destination.lat, role: "destination" })
            setActivePoints([...points.values()])
        }

        const reset = () => {
            requestId++
            origin = null
            destination = null
            setActivePoints([])
            setActiveRoute([])
            setJourney(null)
            setStatus("Click the map to set your departure point")
        }
        resetRef.current = reset

        const planJourney = async (from: LatLng, to: LatLng) => {
            const thisRequest = ++requestId
            setStatus("Finding the best journey…")
            try {
                const res = await fetch(
                    `/api/journey/overview?origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}`
                )
                const data = (await res.json()) as JourneyOverview & { error?: string }
                if (thisRequest !== requestId) return // superseded by a newer click/reset

                if (!res.ok || !data.segments) {
                    setJourney(null)
                    setActiveRoute([])
                    setStatus(data.error ?? "No journey found")
                    return
                }

                setJourney(data)
                renderJourney(data)
                setStatus("Click the map to plan a new journey")
            } catch (err) {
                console.error("Failed to fetch journey overview:", err)
                if (thisRequest === requestId) setStatus("Failed to fetch journey")
            }
        }

        const popup = new Popup({ closeButton: false, closeOnClick: true })

        const showRoutePopup = (feature: NonNullable<MapLayerMouseEvent["features"]>[number], lngLat: MapLayerMouseEvent["lngLat"]) => {
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

            popup.setLngLat(lngLat).setDOMContent(content).addTo(map)
        }

        const handleMapClick = (e: MapLayerMouseEvent) => {
            const routeFeatures = map.queryRenderedFeatures(e.point, { layers: ROUTE_LINE_LAYER_IDS })
            if (routeFeatures.length > 0) {
                showRoutePopup(routeFeatures[0], e.lngLat)
                return
            }

            const point: LatLng = { lat: e.lngLat.lat, lng: e.lngLat.lng }

            if (!origin || destination) {
                // Fresh start: either the very first click, or starting a new
                // journey after one was already planned.
                requestId++
                origin = point
                destination = null
                setJourney(null)
                setActiveRoute([])
                setActivePoints([{ lng: point.lng, lat: point.lat, role: "origin" }])
                setStatus("Departure set — click the map for your destination")
                return
            }

            destination = point
            setActivePoints([
                { lng: origin.lng, lat: origin.lat, role: "origin" },
                { lng: point.lng, lat: point.lat, role: "destination" },
            ])
            void planJourney(origin, destination)
        }

        const handleMouseEnter = () => {
            map.getCanvas().style.cursor = "pointer"
        }
        const handleMouseLeave = () => {
            map.getCanvas().style.cursor = "crosshair"
        }

        map.on("click", handleMapClick)
        for (const layerId of ROUTE_LINE_LAYER_IDS) {
            map.on("mouseenter", layerId, handleMouseEnter)
            map.on("mouseleave", layerId, handleMouseLeave)
        }

        return () => {
            map.remove()
        }
    }, [])

    return (
        <div className="flex h-full w-full">
            <div className="relative min-w-0 flex-1">
                <div ref={containerRef} className="h-full w-full" />
            </div>
            <JourneyPanel journey={journey} status={status} onReset={() => resetRef.current()} />
        </div>
    )
}
