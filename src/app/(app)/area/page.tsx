"use client"

import { useEffect, useState } from "react"
import { PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AreaFormSheet } from "@/components/areas/area-form-sheet"
import { AreaRow } from "@/components/areas/area-row"
import type { Area } from "@/lib/area"

export default function AreaPage() {
    const [areas, setAreas] = useState<Area[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [sheetOpen, setSheetOpen] = useState(false)
    const [editingArea, setEditingArea] = useState<Area | null>(null)

    useEffect(() => {
        let cancelled = false

        async function load() {
            try {
                const res = await fetch("/api/area")
                const data = await res.json<{ areas?: Area[]; error?: string }>().catch(() => null)
                if (cancelled) return
                if (!res.ok || !data?.areas) {
                    setError(data?.error ?? "Failed to load areas")
                    return
                }
                setAreas(data.areas)
            } catch (err) {
                if (cancelled) return
                console.error("Failed to load areas:", err)
                setError("Failed to load areas")
            }
        }

        load()
        return () => {
            cancelled = true
        }
    }, [])

    function openCreate() {
        setEditingArea(null)
        setSheetOpen(true)
    }

    function openEdit(area: Area) {
        setEditingArea(area)
        setSheetOpen(true)
    }

    function handleSaved(area: Area) {
        setAreas((prev) => {
            if (!prev) return [area]
            const exists = prev.some((a) => a.id === area.id)
            return exists ? prev.map((a) => (a.id === area.id ? area : a)) : [...prev, area]
        })
    }

    async function handleDelete(area: Area) {
        try {
            const res = await fetch(`/api/area/${area.id}`, { method: "DELETE" })
            if (!res.ok && res.status !== 204) {
                console.error("Failed to delete area:", await res.text())
                return
            }
            setAreas((prev) => prev?.filter((a) => a.id !== area.id) ?? prev)
        } catch (err) {
            console.error("Failed to delete area:", err)
        }
    }

    return (
        <div className="flex flex-1 flex-col gap-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-heading text-xl font-medium">Areas</h1>
                    <p className="text-sm text-muted-foreground">Group kelurahans together under a shared area with its own center point.</p>
                </div>
                <Button onClick={openCreate}>
                    <PlusIcon /> New area
                </Button>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {areas === null ? (
                <div className="flex flex-col gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-16" />
                    ))}
                </div>
            ) : areas.length === 0 ? (
                <p className="text-sm text-muted-foreground">No areas yet. Create one to get started.</p>
            ) : (
                <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl ring-1 ring-foreground/10">
                    {areas.map((area) => (
                        <AreaRow key={area.id} area={area} onEdit={() => openEdit(area)} onDelete={() => handleDelete(area)} />
                    ))}
                </div>
            )}

            <AreaFormSheet open={sheetOpen} onOpenChange={setSheetOpen} area={editingArea} onSaved={handleSaved} />
        </div>
    )
}
