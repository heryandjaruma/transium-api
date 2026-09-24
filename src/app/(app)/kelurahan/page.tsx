"use client"

import { useEffect, useState } from "react"
import { PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { KelurahanFormSheet } from "@/components/kelurahans/kelurahan-form-sheet"
import { KelurahanRow } from "@/components/kelurahans/kelurahan-row"
import type { Kelurahan } from "@/lib/kelurahan"

export default function KelurahanPage() {
    const [kelurahans, setKelurahans] = useState<Kelurahan[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [sheetOpen, setSheetOpen] = useState(false)
    const [editingKelurahan, setEditingKelurahan] = useState<Kelurahan | null>(null)

    useEffect(() => {
        let cancelled = false

        async function load() {
            try {
                const res = await fetch("/api/kelurahan")
                const data = await res.json<{ kelurahans?: Kelurahan[]; error?: string }>().catch(() => null)
                if (cancelled) return
                if (!res.ok || !data?.kelurahans) {
                    setError(data?.error ?? "Failed to load kelurahans")
                    return
                }
                setKelurahans(data.kelurahans)
            } catch (err) {
                if (cancelled) return
                console.error("Failed to load kelurahans:", err)
                setError("Failed to load kelurahans")
            }
        }

        load()
        return () => {
            cancelled = true
        }
    }, [])

    function openCreate() {
        setEditingKelurahan(null)
        setSheetOpen(true)
    }

    function openEdit(kelurahan: Kelurahan) {
        setEditingKelurahan(kelurahan)
        setSheetOpen(true)
    }

    function handleSaved(kelurahan: Kelurahan) {
        setKelurahans((prev) => {
            if (!prev) return [kelurahan]
            const exists = prev.some((k) => k.id === kelurahan.id)
            return exists ? prev.map((k) => (k.id === kelurahan.id ? kelurahan : k)) : [...prev, kelurahan]
        })
    }

    async function handleDelete(kelurahan: Kelurahan) {
        try {
            const res = await fetch(`/api/kelurahan/${kelurahan.id}`, { method: "DELETE" })
            if (!res.ok && res.status !== 204) {
                console.error("Failed to delete kelurahan:", await res.text())
                return
            }
            setKelurahans((prev) => prev?.filter((k) => k.id !== kelurahan.id) ?? prev)
        } catch (err) {
            console.error("Failed to delete kelurahan:", err)
        }
    }

    return (
        <div className="flex flex-1 flex-col gap-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-heading text-xl font-medium">Kelurahan</h1>
                    <p className="text-sm text-muted-foreground">Manage kelurahans badges can be scoped to.</p>
                </div>
                <Button onClick={openCreate}>
                    <PlusIcon /> New kelurahan
                </Button>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {kelurahans === null ? (
                <div className="flex flex-col gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-16" />
                    ))}
                </div>
            ) : kelurahans.length === 0 ? (
                <p className="text-sm text-muted-foreground">No kelurahans yet. Create one to get started.</p>
            ) : (
                <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl ring-1 ring-foreground/10">
                    {kelurahans.map((kelurahan) => (
                        <KelurahanRow
                            key={kelurahan.id}
                            kelurahan={kelurahan}
                            onEdit={() => openEdit(kelurahan)}
                            onDelete={() => handleDelete(kelurahan)}
                        />
                    ))}
                </div>
            )}

            <KelurahanFormSheet open={sheetOpen} onOpenChange={setSheetOpen} kelurahan={editingKelurahan} onSaved={handleSaved} />
        </div>
    )
}
