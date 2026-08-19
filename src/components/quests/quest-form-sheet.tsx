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
import { QuestBadges } from "@/components/quests/quest-badges"
import { QuestThumbnails } from "@/components/quests/quest-thumbnails"
import type { Quest } from "@/lib/quest"

type Props = {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** `null` opens the sheet in create mode. */
    quest: Quest | null
    onSaved: (quest: Quest) => void
}

const emptyForm = { name: "", category: "", description: "", xp: "0", label: "" }

/** Create/edit sheet for a quest. Once the quest exists (editing, or just created), also manages its thumbnails. */
export function QuestFormSheet({ open, onOpenChange, quest, onSaved }: Props) {
    const [savedQuest, setSavedQuest] = useState<Quest | null>(quest)
    const [form, setForm] = useState(emptyForm)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        setSavedQuest(quest)
        setForm(
            quest
                ? { name: quest.name, category: quest.category, description: quest.description, xp: String(quest.xp), label: quest.label ?? "" }
                : emptyForm
        )
        setError(null)
    }, [open, quest])

    const isEditing = savedQuest !== null

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!form.name.trim() || !form.category.trim() || !form.description.trim()) {
            setError("All fields are required")
            return
        }
        const xp = Number(form.xp)
        if (!Number.isInteger(xp) || xp < 0) {
            setError("XP must be a whole number, 0 or greater")
            return
        }

        setSaving(true)
        setError(null)
        try {
            const body = {
                name: form.name.trim(),
                category: form.category.trim(),
                description: form.description.trim(),
                xp,
                label: form.label.trim() || null,
            }
            const res = await fetch(isEditing ? `/api/quest/${savedQuest!.id}` : "/api/quest", {
                method: isEditing ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })
            const data = await res.json<{ quest?: Quest; error?: string }>().catch(() => null)
            if (!res.ok || !data?.quest) {
                setError(data?.error ?? "Failed to save quest")
                return
            }
            setSavedQuest(data.quest)
            onSaved(data.quest)
        } catch (err) {
            console.error("Failed to save quest:", err)
            setError("Failed to save quest")
        } finally {
            setSaving(false)
        }
    }

    function handleThumbnailsChange(thumbnails: Quest["thumbnails"]) {
        if (!savedQuest) return
        const next = { ...savedQuest, thumbnails }
        setSavedQuest(next)
        onSaved(next)
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent>
                <SheetHeader>
                    <SheetTitle>{isEditing ? "Edit quest" : "New quest"}</SheetTitle>
                    <SheetDescription>
                        {isEditing ? "Update quest details and thumbnails." : "Create a quest, then add thumbnails."}
                    </SheetDescription>
                </SheetHeader>

                <form id="quest-form" onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 overflow-y-auto px-6">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="quest-name">Name</Label>
                        <Input
                            id="quest-name"
                            value={form.name}
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            disabled={saving}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="quest-category">Category</Label>
                        <Input
                            id="quest-category"
                            value={form.category}
                            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                            disabled={saving}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="quest-description">Description</Label>
                        <Textarea
                            id="quest-description"
                            value={form.description}
                            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                            disabled={saving}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="quest-xp">XP</Label>
                        <Input
                            id="quest-xp"
                            type="number"
                            min={0}
                            step={1}
                            value={form.xp}
                            onChange={(e) => setForm((f) => ({ ...f, xp: e.target.value }))}
                            disabled={saving}
                        />
                        <p className="text-xs text-muted-foreground">Added to a user&apos;s level when they complete this quest&apos;s journey.</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="quest-label">Label</Label>
                        <Input
                            id="quest-label"
                            value={form.label}
                            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                            placeholder="e.g. recommended"
                            disabled={saving}
                        />
                        <p className="text-xs text-muted-foreground">Optional highlight tag. Leave blank for none.</p>
                    </div>

                    {error && <p className="text-sm text-destructive">{error}</p>}

                    {savedQuest && (
                        <div className="flex flex-col gap-1.5 border-t border-border pt-4">
                            <Label>Thumbnails</Label>
                            <QuestThumbnails
                                questId={savedQuest.id}
                                thumbnails={savedQuest.thumbnails}
                                onChange={handleThumbnailsChange}
                            />
                        </div>
                    )}

                    {savedQuest && (
                        <div className="flex flex-col gap-1.5 border-t border-border pt-4">
                            <Label>Badges</Label>
                            <QuestBadges questId={savedQuest.id} />
                        </div>
                    )}
                </form>

                <SheetFooter className="flex-row justify-end">
                    <SheetClose render={<Button variant="outline" type="button" />}>Close</SheetClose>
                    <Button type="submit" form="quest-form" disabled={saving}>
                        {saving ? "Saving…" : isEditing ? "Save changes" : "Create quest"}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
