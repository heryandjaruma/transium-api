"use client"

import { useEffect, useState } from "react"
import { PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { BadgeCard } from "@/components/badges/badge-card"
import { BadgeFormSheet } from "@/components/badges/badge-form-sheet"
import type { Badge } from "@/lib/badge"

export default function BadgesPage() {
    const [badges, setBadges] = useState<Badge[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [sheetOpen, setSheetOpen] = useState(false)
    const [editingBadge, setEditingBadge] = useState<Badge | null>(null)

    useEffect(() => {
        let cancelled = false

        async function loadBadges() {
            try {
                const res = await fetch("/api/badge")
                const data = await res.json<{ badges?: Badge[]; error?: string }>().catch(() => null)
                if (cancelled) return
                if (!res.ok || !data?.badges) {
                    setError(data?.error ?? "Failed to load badges")
                    return
                }
                setBadges(data.badges)
            } catch (err) {
                if (cancelled) return
                console.error("Failed to load badges:", err)
                setError("Failed to load badges")
            }
        }

        loadBadges()
        return () => {
            cancelled = true
        }
    }, [])

    function openCreate() {
        setEditingBadge(null)
        setSheetOpen(true)
    }

    function openEdit(badge: Badge) {
        setEditingBadge(badge)
        setSheetOpen(true)
    }

    function handleSaved(badge: Badge) {
        setBadges((prev) => {
            if (!prev) return [badge]
            const exists = prev.some((b) => b.id === badge.id)
            return exists ? prev.map((b) => (b.id === badge.id ? badge : b)) : [...prev, badge]
        })
        setEditingBadge(badge)
    }

    async function handleDelete(badge: Badge) {
        try {
            const res = await fetch(`/api/badge/${badge.id}`, { method: "DELETE" })
            if (!res.ok && res.status !== 204) {
                console.error("Failed to delete badge:", await res.text())
                return
            }
            setBadges((prev) => prev?.filter((b) => b.id !== badge.id) ?? prev)
        } catch (err) {
            console.error("Failed to delete badge:", err)
        }
    }

    return (
        <div className="flex flex-1 flex-col gap-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-heading text-xl font-medium">Badges</h1>
                    <p className="text-sm text-muted-foreground">Manage badges and their images.</p>
                </div>
                <Button onClick={openCreate}>
                    <PlusIcon /> New badge
                </Button>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {badges === null ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-64" />
                    ))}
                </div>
            ) : badges.length === 0 ? (
                <p className="text-sm text-muted-foreground">No badges yet. Create one to get started.</p>
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {badges.map((badge) => (
                        <BadgeCard
                            key={badge.id}
                            badge={badge}
                            onEdit={() => openEdit(badge)}
                            onDelete={() => handleDelete(badge)}
                        />
                    ))}
                </div>
            )}

            <BadgeFormSheet open={sheetOpen} onOpenChange={setSheetOpen} badge={editingBadge} onSaved={handleSaved} />
        </div>
    )
}
