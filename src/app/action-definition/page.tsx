"use client"

import { useEffect, useState } from "react"
import { PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ActionDefinitionFormSheet } from "@/components/action-definitions/action-definition-form-sheet"
import { ActionDefinitionRow } from "@/components/action-definitions/action-definition-row"
import type { ActionDefinition } from "@/lib/action-definition"

export default function ActionDefinitionPage() {
    const [actions, setActions] = useState<ActionDefinition[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [sheetOpen, setSheetOpen] = useState(false)
    const [editingAction, setEditingAction] = useState<ActionDefinition | null>(null)

    useEffect(() => {
        let cancelled = false

        async function load() {
            try {
                const res = await fetch("/api/action-definition")
                const data = await res.json<{ actionDefinitions?: ActionDefinition[]; error?: string }>().catch(() => null)
                if (cancelled) return
                if (!res.ok || !data?.actionDefinitions) {
                    setError(data?.error ?? "Failed to load action definitions")
                    return
                }
                setActions(data.actionDefinitions)
            } catch (err) {
                if (cancelled) return
                console.error("Failed to load action definitions:", err)
                setError("Failed to load action definitions")
            }
        }

        load()
        return () => {
            cancelled = true
        }
    }, [])

    function openCreate() {
        setEditingAction(null)
        setSheetOpen(true)
    }

    function openEdit(action: ActionDefinition) {
        setEditingAction(action)
        setSheetOpen(true)
    }

    function handleSaved(action: ActionDefinition) {
        setActions((prev) => {
            if (!prev) return [action]
            const exists = prev.some((a) => a.id === action.id)
            return exists ? prev.map((a) => (a.id === action.id ? action : a)) : [...prev, action]
        })
    }

    async function handleDelete(action: ActionDefinition) {
        try {
            const res = await fetch(`/api/action-definition/${action.id}`, { method: "DELETE" })
            if (!res.ok && res.status !== 204) {
                console.error("Failed to delete action definition:", await res.text())
                return
            }
            setActions((prev) => prev?.filter((a) => a.id !== action.id) ?? prev)
        } catch (err) {
            console.error("Failed to delete action definition:", err)
        }
    }

    return (
        <div className="flex flex-1 flex-col gap-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-heading text-xl font-medium">Action Definitions</h1>
                    <p className="text-sm text-muted-foreground">Manage the types of actions users can do.</p>
                </div>
                <Button onClick={openCreate}>
                    <PlusIcon /> New action
                </Button>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {actions === null ? (
                <div className="flex flex-col gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-16" />
                    ))}
                </div>
            ) : actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No action definitions yet. Create one to get started.</p>
            ) : (
                <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl ring-1 ring-foreground/10">
                    {actions.map((action) => (
                        <ActionDefinitionRow
                            key={action.id}
                            action={action}
                            onEdit={() => openEdit(action)}
                            onDelete={() => handleDelete(action)}
                        />
                    ))}
                </div>
            )}

            <ActionDefinitionFormSheet open={sheetOpen} onOpenChange={setSheetOpen} action={editingAction} onSaved={handleSaved} />
        </div>
    )
}
