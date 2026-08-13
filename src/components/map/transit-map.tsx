"use client"

import { useEffect, useRef } from "react"
import {
    Map as MaplibreMap,
    NavigationControl,
    Popup,
    addProtocol,
    setWorkerUrl,
    type MapLayerMouseEvent,
} from "maplibre-gl"
import { Protocol } from "pmtiles"
import "maplibre-gl/dist/maplibre-gl.css"

import {
    BASEMAP_BOUNDS,
    TRANSIT_BOUNDS,
    transitMapStyle,
} from "@/components/map/transit-map-style"

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

export function TransitMap() {
    const containerRef = useRef<HTMLDivElement | null>(null)

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

        const popup = new Popup({ closeButton: false, closeOnClick: true })

        const handleClick = (e: MapLayerMouseEvent) => {
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

        const handleMouseEnter = () => {
            map.getCanvas().style.cursor = "pointer"
        }
        const handleMouseLeave = () => {
            map.getCanvas().style.cursor = ""
        }

        for (const layerId of INTERACTIVE_LAYER_IDS) {
            map.on("click", layerId, handleClick)
            map.on("mouseenter", layerId, handleMouseEnter)
            map.on("mouseleave", layerId, handleMouseLeave)
        }

        return () => {
            map.remove()
        }
    }, [])

    return <div ref={containerRef} className="h-full w-full" />
}
