"use client"

import { useEffect, useRef, useState } from "react"
import {
    Map as MaplibreMap,
    Marker,
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
import type {
    JourneyAlternatives,
    JourneyOverview,
    JourneyOverviewResponse,
    JourneySegment,
    LatLng,
    RouteProfileKey,
} from "@/lib/journey"

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

/**
 * Bold chevron pointing "up"; symbol-placement:"line" rotates it to match each line's
 * bearing. Drawn as a white-haloed stroke (not a small filled triangle) so it stays
 * legible at small render sizes and reads on top of any route line color.
 */
function addRouteArrowIcon(map: MaplibreMap) {
    if (map.hasImage("route-arrow")) return
    const size = 48
    const canvas = document.createElement("canvas")
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext("2d")!
    const drawChevron = () => {
        ctx.beginPath()
        ctx.moveTo(size * 0.22, size * 0.66)
        ctx.lineTo(size * 0.5, size * 0.2)
        ctx.lineTo(size * 0.78, size * 0.66)
    }
    ctx.lineJoin = "round"
    ctx.lineCap = "round"
    drawChevron()
    ctx.lineWidth = size * 0.24
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)"
    ctx.stroke()
    drawChevron()
    ctx.lineWidth = size * 0.12
    ctx.strokeStyle = "#1e293b"
    ctx.stroke()
    map.addImage("route-arrow", ctx.getImageData(0, 0, size, size))
}

const EARTH_RADIUS_METERS = 6371000

function haversineMeters(a: [number, number], b: [number, number]) {
    const toRad = (d: number) => (d * Math.PI) / 180
    const dLat = toRad(b[1] - a[1])
    const dLng = toRad(b[0] - a[0])
    const lat1 = toRad(a[1])
    const lat2 = toRad(b[1])
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h))
}

/** Initial bearing from a to b, in degrees clockwise from north (matches icon-rotate). */
function bearingDegrees(a: [number, number], b: [number, number]) {
    const toRad = (d: number) => (d * Math.PI) / 180
    const toDeg = (r: number) => (r * 180) / Math.PI
    const lat1 = toRad(a[1])
    const lat2 = toRad(b[1])
    const dLng = toRad(b[0] - a[0])
    const y = Math.sin(dLng) * Math.cos(lat2)
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
    return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function pointAtDistance(coords: [number, number][], cumDist: number[], target: number): [number, number] {
    if (target <= 0) return coords[0]
    const total = cumDist[cumDist.length - 1]
    if (target >= total) return coords[coords.length - 1]
    for (let i = 1; i < coords.length; i++) {
        if (cumDist[i] >= target) {
            const segStart = cumDist[i - 1]
            const segEnd = cumDist[i]
            const t = segEnd === segStart ? 0 : (target - segStart) / (segEnd - segStart)
            const a = coords[i - 1]
            const b = coords[i]
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        }
    }
    return coords[coords.length - 1]
}

/**
 * Walks a line at a fixed meter interval, placing an arrow anchor at each stop.
 * Each anchor's bearing points at the *next* anchor's position (one full spacing
 * step ahead), not at the nearest raw vertex — real-world route shapes (bus GPS
 * traces, walking directions, opposite-carriageway loops picked up while slicing a
 * route's shape) can wander back and forth locally over tens of meters, which made
 * bearings computed from nearby vertices flip direction from one arrow to the next.
 * Aiming each arrow at the following one guarantees consecutive arrows never
 * contradict each other, while the line itself still renders the real path.
 */
function sampleArrowAnchors(coords: [number, number][], spacingMeters: number) {
    const anchors: { point: [number, number]; bearing: number }[] = []
    if (coords.length < 2) return anchors

    const cumDist = [0]
    for (let i = 1; i < coords.length; i++) cumDist.push(cumDist[i - 1] + haversineMeters(coords[i - 1], coords[i]))
    const total = cumDist[cumDist.length - 1]
    if (total === 0) return anchors

    for (let d = spacingMeters / 2; d < total; d += spacingMeters) {
        const from = pointAtDistance(coords, cumDist, d)
        const to = pointAtDistance(coords, cumDist, Math.min(total, d + spacingMeters))
        if (from[0] === to[0] && from[1] === to[1]) continue
        anchors.push({ point: from, bearing: bearingDegrees(from, to) })
    }
    return anchors
}

/** ~5 arrows per segment regardless of length, but never denser than every 60m or sparser than every 220m. */
function spacingForSegment(coords: [number, number][]) {
    let total = 0
    for (let i = 1; i < coords.length; i++) total += haversineMeters(coords[i - 1], coords[i])
    return Math.min(220, Math.max(60, total / 5))
}

type ActivePoint = { lng: number; lat: number; role: "origin" | "destination" | "stop"; name?: string }

/**
 * Every stop this segment touches. For bus legs this includes every stop the
 * bus passes through (not just where the rider boards/alights), so the whole
 * ride shows up as a string of labeled points along the route.
 */
function segmentStopPoints(segment: JourneySegment): { stopId: string; lat: number; lng: number; name: string }[] {
    if (segment.type === "walk") {
        return [segment.from, segment.to].filter(
            (p): p is typeof p & { stopId: string } => typeof p.stopId === "string"
        )
    }
    if (segment.type === "bus") {
        return segment.stops.map((stop) => ({ stopId: stop.stopId, lat: stop.lat, lng: stop.lng, name: stop.name }))
    }
    if (segment.type === "mission") return []
    return [segment.from, segment.to]
}

export function TransitMap() {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const [status, setStatus] = useState("Click the map to set your departure point")
    const [journey, setJourney] = useState<JourneyOverview | null>(null)
    const [alternatives, setAlternatives] = useState<JourneyAlternatives | null>(null)
    const [selectedProfile, setSelectedProfile] = useState<RouteProfileKey>("lessWalking")
    const resetRef = useRef<() => void>(() => {})
    const selectProfileRef = useRef<(key: RouteProfileKey) => void>(() => {})

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
            addRouteArrowIcon(map)
        })

        let origin: LatLng | null = null
        let destination: LatLng | null = null
        let requestId = 0
        let currentAlternatives: JourneyAlternatives | null = null

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

        // Text labels are plain DOM markers rather than a symbol layer: the
        // style has no glyphs source configured (it's a self-contained
        // pmtiles setup), so MapLibre can't render symbol text on its own.
        let stopLabelMarkers: Marker[] = []

        const clearStopLabels = () => {
            for (const marker of stopLabelMarkers) marker.remove()
            stopLabelMarkers = []
        }

        const setStopLabels = (points: ActivePoint[]) => {
            clearStopLabels()
            stopLabelMarkers = points
                .filter((p) => p.role === "stop" && p.name)
                .map((p) => {
                    const el = document.createElement("div")
                    el.className =
                        "pointer-events-none select-none whitespace-nowrap rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium leading-none text-slate-800 shadow-sm ring-1 ring-black/10"
                    el.textContent = p.name!
                    return new Marker({ element: el, anchor: "left", offset: [8, 0] })
                        .setLngLat([p.lng, p.lat])
                        .addTo(map)
                })
        }

        const setActiveRoute = (segments: JourneySegment[]) => {
            const source = map.getSource("active-route") as GeoJSONSource | undefined
            source?.setData({
                type: "FeatureCollection",
                features: segments
                    .filter((seg) => seg.type !== "mission")
                    .map((seg) => ({
                        type: "Feature",
                        geometry: { type: "LineString", coordinates: seg.geometry },
                        properties: {
                            kind: seg.type,
                            color: seg.type === "bus" ? seg.routeColor ?? "#1a1a1a" : undefined,
                        },
                    })),
            })
        }

        const setActiveRouteArrows = (segments: JourneySegment[]) => {
            const source = map.getSource("active-route-arrow-points") as GeoJSONSource | undefined
            source?.setData({
                type: "FeatureCollection",
                features: segments
                    .filter((seg) => seg.type !== "mission")
                    .flatMap((seg) => {
                        const coords = seg.geometry
                        return sampleArrowAnchors(coords, spacingForSegment(coords)).map((anchor) => ({
                            type: "Feature" as const,
                            geometry: { type: "Point" as const, coordinates: anchor.point },
                            properties: { bearing: anchor.bearing },
                        }))
                    }),
            })
        }

        const renderJourney = (j: JourneyOverview) => {
            setActiveRoute(j.segments)
            setActiveRouteArrows(j.segments)

            const points = new Map<string, ActivePoint>()
            for (const segment of j.segments) {
                for (const stop of segmentStopPoints(segment)) {
                    if (!points.has(stop.stopId)) {
                        points.set(stop.stopId, { lng: stop.lng, lat: stop.lat, role: "stop", name: stop.name })
                    }
                }
            }
            // Origin/destination pins always win over a same-spot stop pin.
            points.set("__origin", { lng: j.origin.lng, lat: j.origin.lat, role: "origin" })
            points.set("__destination", { lng: j.destination.lng, lat: j.destination.lat, role: "destination" })
            const activePoints = [...points.values()]
            setActivePoints(activePoints)
            setStopLabels(activePoints)
        }

        const reset = () => {
            requestId++
            origin = null
            destination = null
            currentAlternatives = null
            setActivePoints([])
            setActiveRoute([])
            setActiveRouteArrows([])
            clearStopLabels()
            setJourney(null)
            setAlternatives(null)
            setSelectedProfile("lessWalking")
            setStatus("Click the map to set your departure point")
        }
        resetRef.current = reset

        // Switches which of the two fetched alternatives (less walking / fewer
        // transfers) is drawn on the map, without refetching. Falls back to whichever
        // alternative exists if the requested one came back null (no route under that
        // profile — e.g. a single-route journey where both profiles agree anyway).
        const applySelection = (key: RouteProfileKey) => {
            if (!currentAlternatives) return
            const resolvedKey = currentAlternatives[key] ? key : (Object.keys(currentAlternatives) as RouteProfileKey[]).find(
                (k) => currentAlternatives![k]
            )
            const chosen = resolvedKey ? currentAlternatives[resolvedKey] : null
            if (!chosen || !resolvedKey) return

            setSelectedProfile(resolvedKey)
            setJourney(chosen)
            renderJourney(chosen)
        }
        selectProfileRef.current = applySelection

        const planJourney = async (from: LatLng, to: LatLng) => {
            const thisRequest = ++requestId
            setStatus("Finding the best journey…")
            try {
                const res = await fetch(
                    `/api/journey/overview?origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}`
                )
                const data = (await res.json()) as JourneyOverviewResponse & { error?: string }
                if (thisRequest !== requestId) return // superseded by a newer click/reset

                if (!res.ok || !data.best) {
                    setJourney(null)
                    setAlternatives(null)
                    setActiveRoute([])
                    setActiveRouteArrows([])
                    setStatus(data.error ?? "No journey found")
                    return
                }

                // Alternatives are only worth offering a switch for when the two
                // profiles genuinely differ — otherwise `best` already covers it.
                currentAlternatives = data.alternativesAvailable
                    ? { lessWalking: data.lessWalking ?? null, lessTransit: data.lessTransit ?? null }
                    : null
                setAlternatives(currentAlternatives)

                if (currentAlternatives) {
                    applySelection("lessWalking")
                } else {
                    setSelectedProfile("lessWalking")
                    setJourney(data.best)
                    renderJourney(data.best)
                }
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
                setActiveRouteArrows([])
                clearStopLabels()
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
            <JourneyPanel
                journey={journey}
                alternatives={alternatives}
                selectedProfile={selectedProfile}
                onSelectProfile={(key) => selectProfileRef.current(key)}
                status={status}
                onReset={() => resetRef.current()}
            />
        </div>
    )
}
