"use client"

import { useEffect, useState } from "react"
import { Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { Kelurahan } from "@/lib/kelurahan"

type Props = {
    areaId: string
}

/** Lists every kelurahan and lets you add/remove it from this area, via Kelurahan.areaId. */
export function AreaKelurahanMapper({ areaId }: Props) {
    const [kelurahans, setKelurahans] = useState<Kelurahan[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [pendingId, setPendingId] = useState<string | null>(null)

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

    async function toggle(kelurahan: Kelurahan) {
        const nextAreaId = kelurahan.areaId === areaId ? null : areaId
        setPendingId(kelurahan.id)
        setError(null)
        try {
            const res = await fetch(`/api/kelurahan/${kelurahan.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ areaId: nextAreaId }),
            })
            const data = await res.json<{ kelurahan?: Kelurahan; error?: string }>().catch(() => null)
            if (!res.ok || !data?.kelurahan) {
                setError(data?.error ?? "Failed to update kelurahan")
                return
            }
            const updated = data.kelurahan
            setKelurahans((prev) => prev?.map((k) => (k.id === updated.id ? updated : k)) ?? prev)
        } catch (err) {
            console.error("Failed to update kelurahan:", err)
            setError("Failed to update kelurahan")
        } finally {
            setPendingId(null)
        }
    }

    if (kelurahans === null) {
        return <p className="text-sm text-muted-foreground">Loading kelurahans…</p>
    }

    if (kelurahans.length === 0) {
        return <p className="text-sm text-muted-foreground">No kelurahans yet. Create one on the Kelurahan page first.</p>
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col divide-y divide-border rounded-xl ring-1 ring-foreground/10">
                {kelurahans.map((kelurahan) => {
                    const inThisArea = kelurahan.areaId === areaId
                    const inOtherArea = kelurahan.areaId !== null && !inThisArea
                    return (
                        <div key={kelurahan.id} className="flex items-center gap-3 p-3">
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-medium">{kelurahan.kelurahanName}</p>
                                <p className="truncate text-sm text-muted-foreground">
                                    {kelurahan.kecamatanName}
                                    {inOtherArea && " · currently in another area"}
                                </p>
                            </div>
                            <Button
                                type="button"
                                variant={inThisArea ? "destructive" : "outline"}
                                size="sm"
                                onClick={() => toggle(kelurahan)}
                                disabled={pendingId === kelurahan.id}
                            >
                                {pendingId === kelurahan.id ? <Loader2Icon className="animate-spin" /> : inThisArea ? "Remove" : inOtherArea ? "Move here" : "Add"}
                            </Button>
                        </div>
                    )
                })}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
    )
}
