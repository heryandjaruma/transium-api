"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import type { ActionDefinition } from "@/lib/action-definition"

type Props = {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** `null` opens the sheet in create mode. */
    action: ActionDefinition | null
    onSaved: (action: ActionDefinition) => void
}

const emptyForm = { name: "", description: "", type: "" }

/** Create/edit sheet for an action definition — no media involved, so it closes itself on save. */
export function ActionDefinitionFormSheet({ open, onOpenChange, action, onSaved }: Props) {
    const [form, setForm] = useState(emptyForm)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const isEditing = action !== null

    useEffect(() => {
        if (!open) return
        setForm(action ? { name: action.name, description: action.description, type: action.type } : emptyForm)
        setError(null)
    }, [open, action])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!form.name.trim() || !form.description.trim() || !form.type.trim()) {
            setError("All fields are required")
            return
        }

        setSaving(true)
        setError(null)
        try {
            const res = await fetch(isEditing ? `/api/action-definition/${action!.id}` : "/api/action-definition", {
                method: isEditing ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            })
            const data = await res.json<{ actionDefinition?: ActionDefinition; error?: string }>().catch(() => null)
            if (!res.ok || !data?.actionDefinition) {
                setError(data?.error ?? "Failed to save action")
                return
            }
            onSaved(data.actionDefinition)
            onOpenChange(false)
        } catch (err) {
            console.error("Failed to save action definition:", err)
            setError("Failed to save action")
        } finally {
            setSaving(false)
        }
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent>
                <SheetHeader>
                    <SheetTitle>{isEditing ? "Edit action" : "New action"}</SheetTitle>
                    <SheetDescription>
                        {isEditing ? "Update this action definition." : "Define a new type of action users can do."}
                    </SheetDescription>
                </SheetHeader>

                <form id="action-definition-form" onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 overflow-y-auto px-6">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="action-name">Name</Label>
                        <Input
                            id="action-name"
                            value={form.name}
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            disabled={saving}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="action-type">Type</Label>
                        <Input
                            id="action-type"
                            value={form.type}
                            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                            disabled={saving}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="action-description">Description</Label>
                        <Textarea
                            id="action-description"
                            value={form.description}
                            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                            disabled={saving}
                        />
                    </div>

                    {error && <p className="text-sm text-destructive">{error}</p>}
                </form>

                <SheetFooter className="flex-row justify-end">
                    <SheetClose render={<Button variant="outline" type="button" />}>Close</SheetClose>
                    <Button type="submit" form="action-definition-form" disabled={saving}>
                        {saving ? "Saving…" : isEditing ? "Save changes" : "Create action"}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
