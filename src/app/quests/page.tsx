"use client"

import { useEffect, useState } from "react"
import { PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { QuestCard } from "@/components/quests/quest-card"
import { QuestFormSheet } from "@/components/quests/quest-form-sheet"
import type { Quest } from "@/lib/quest"

export default function QuestsPage() {
    const [quests, setQuests] = useState<Quest[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [sheetOpen, setSheetOpen] = useState(false)
    const [editingQuest, setEditingQuest] = useState<Quest | null>(null)

    useEffect(() => {
        let cancelled = false

        async function loadQuests() {
            try {
                const res = await fetch("/api/quest")
                const data = await res.json<{ quests?: Quest[]; error?: string }>().catch(() => null)
                if (cancelled) return
                if (!res.ok || !data?.quests) {
                    setError(data?.error ?? "Failed to load quests")
                    return
                }
                setQuests(data.quests)
            } catch (err) {
                if (cancelled) return
                console.error("Failed to load quests:", err)
                setError("Failed to load quests")
            }
        }

        loadQuests()
        return () => {
            cancelled = true
        }
    }, [])

    function openCreate() {
        setEditingQuest(null)
        setSheetOpen(true)
    }

    function openEdit(quest: Quest) {
        setEditingQuest(quest)
        setSheetOpen(true)
    }

    function handleSaved(quest: Quest) {
        setQuests((prev) => {
            if (!prev) return [quest]
            const exists = prev.some((q) => q.id === quest.id)
            return exists ? prev.map((q) => (q.id === quest.id ? quest : q)) : [...prev, quest]
        })
        setEditingQuest(quest)
    }

    async function handleDelete(quest: Quest) {
        try {
            const res = await fetch(`/api/quest/${quest.id}`, { method: "DELETE" })
            if (!res.ok && res.status !== 204) {
                console.error("Failed to delete quest:", await res.text())
                return
            }
            setQuests((prev) => prev?.filter((q) => q.id !== quest.id) ?? prev)
        } catch (err) {
            console.error("Failed to delete quest:", err)
        }
    }

    return (
        <div className="flex flex-1 flex-col gap-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-heading text-xl font-medium">Quests</h1>
                    <p className="text-sm text-muted-foreground">Manage quests and their thumbnails.</p>
                </div>
                <Button onClick={openCreate}>
                    <PlusIcon /> New quest
                </Button>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {quests === null ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-64" />
                    ))}
                </div>
            ) : quests.length === 0 ? (
                <p className="text-sm text-muted-foreground">No quests yet. Create one to get started.</p>
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {quests.map((quest) => (
                        <QuestCard
                            key={quest.id}
                            quest={quest}
                            onEdit={() => openEdit(quest)}
                            onDelete={() => handleDelete(quest)}
                        />
                    ))}
                </div>
            )}

            <QuestFormSheet open={sheetOpen} onOpenChange={setSheetOpen} quest={editingQuest} onSaved={handleSaved} />
        </div>
    )
}
