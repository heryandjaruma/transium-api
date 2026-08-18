"use client"

import { useEffect, useState } from "react"
import { PlusIcon, XIcon } from "lucide-react"

import { Badge as BadgePill } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Badge } from "@/lib/badge"
import type { QuestBadgeEntry } from "@/lib/quest-badge"

type Props = {
    questId: string
}

/** Attach/detach badges for a quest (QuestBadge is many-to-many, so a quest can have several). */
export function QuestBadges({ questId }: Props) {
    const [attached, setAttached] = useState<QuestBadgeEntry[] | null>(null)
    const [allBadges, setAllBadges] = useState<Badge[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [detachingId, setDetachingId] = useState<string | null>(null)
    const [attaching, setAttaching] = useState(false)
    const [picking, setPicking] = useState(false)
    const [pickedBadgeId, setPickedBadgeId] = useState<string>("")

    useEffect(() => {
        let cancelled = false

        async function load() {
            try {
                const [attachedRes, badgesRes] = await Promise.all([
                    fetch(`/api/quest/${questId}/badges`),
                    fetch("/api/badge"),
                ])
                const attachedData = await attachedRes.json<{ questBadges?: QuestBadgeEntry[]; error?: string }>().catch(() => null)
                const badgesData = await badgesRes.json<{ badges?: Badge[] }>().catch(() => null)
                if (cancelled) return

                if (!attachedRes.ok || !attachedData?.questBadges) {
                    setError(attachedData?.error ?? "Failed to load badges")
                } else {
                    setAttached(attachedData.questBadges)
                }
                setAllBadges(badgesData?.badges ?? [])
            } catch (err) {
                if (cancelled) return
                console.error("Failed to load quest badges:", err)
                setError("Failed to load badges")
            }
        }

        load()
        return () => {
            cancelled = true
        }
    }, [questId])

    const availableBadges = (allBadges ?? []).filter(
        (badge) => !(attached ?? []).some((entry) => entry.badgeId === badge.id)
    )

    function startPick() {
        setPickedBadgeId("")
        setError(null)
        setPicking(true)
    }

    function cancelPick() {
        setPicking(false)
        setError(null)
    }

    async function handleAttach() {
        if (!pickedBadgeId) {
            setError("Pick a badge")
            return
        }

        setAttaching(true)
        setError(null)
        try {
            const res = await fetch(`/api/quest/${questId}/badges`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ badgeId: pickedBadgeId }),
            })
            const data = await res.json<{ questBadge?: QuestBadgeEntry; error?: string }>().catch(() => null)
            if (!res.ok || !data?.questBadge) {
                setError(data?.error ?? "Failed to attach badge")
                return
            }
            setAttached((prev) => [...(prev ?? []), data.questBadge!])
            setPicking(false)
        } catch (err) {
            console.error("Failed to attach badge:", err)
            setError("Failed to attach badge")
        } finally {
            setAttaching(false)
        }
    }

    async function handleDetach(entry: QuestBadgeEntry) {
        setDetachingId(entry.id)
        setError(null)
        try {
            const res = await fetch(`/api/quest/${questId}/badges/${entry.badgeId}`, { method: "DELETE" })
            if (!res.ok && res.status !== 204) {
                const data = await res.json<{ error?: string }>().catch(() => null)
                setError(data?.error ?? "Failed to detach badge")
                return
            }
            setAttached((prev) => (prev ?? []).filter((e) => e.id !== entry.id))
        } catch (err) {
            console.error("Failed to detach badge:", err)
            setError("Failed to detach badge")
        } finally {
            setDetachingId(null)
        }
    }

    return (
        <div className="flex flex-col gap-2">
            {attached === null ? (
                <p className="text-sm text-muted-foreground">Loading badges…</p>
            ) : (
                <>
                    {attached.length > 0 && (
                        <div className="flex flex-col divide-y divide-border rounded-xl ring-1 ring-foreground/10">
                            {attached.map((entry) => (
                                <div key={entry.id} className="flex items-center gap-3 px-3 py-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-sm font-medium">{entry.badgeName}</span>
                                            <BadgePill variant="outline">{entry.badgeCategory}</BadgePill>
                                            <BadgePill variant="secondary">{entry.badgeType}</BadgePill>
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={() => handleDetach(entry)}
                                        disabled={detachingId === entry.id}
                                        aria-label={`Detach ${entry.badgeName}`}
                                    >
                                        <XIcon />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}

                    {attached.length === 0 && !picking && <p className="text-sm text-muted-foreground">No badges attached yet.</p>}

                    {picking ? (
                        <div className="flex flex-wrap items-center gap-2">
                            <Select
                                value={pickedBadgeId}
                                onValueChange={(value) => setPickedBadgeId((value as string) ?? "")}
                                items={Object.fromEntries(availableBadges.map((badge) => [badge.id, badge.name]))}
                            >
                                <SelectTrigger size="sm" className="min-w-40 flex-1">
                                    <SelectValue placeholder="Choose a badge" />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableBadges.map((badge) => (
                                        <SelectItem key={badge.id} value={badge.id}>
                                            {badge.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button type="button" variant="ghost" size="sm" onClick={cancelPick} disabled={attaching}>
                                Cancel
                            </Button>
                            <Button type="button" size="sm" onClick={handleAttach} disabled={attaching}>
                                {attaching ? "Attaching…" : "Attach"}
                            </Button>
                        </div>
                    ) : (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={startPick}
                            disabled={allBadges === null || availableBadges.length === 0}
                        >
                            <PlusIcon /> Attach badge
                        </Button>
                    )}

                    {allBadges !== null && allBadges.length === 0 && (
                        <p className="text-sm text-muted-foreground">Create a badge first to attach one.</p>
                    )}
                </>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
    )
}
