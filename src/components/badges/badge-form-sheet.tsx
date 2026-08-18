"use client"

import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
import { BadgeImage } from "@/components/badges/badge-image"
import { BadgeSteps } from "@/components/badges/badge-steps"
import type { Badge } from "@/lib/badge"
import type { Kelurahan } from "@/lib/kelurahan"

type Props = {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** `null` opens the sheet in create mode. */
    badge: Badge | null
    onSaved: (badge: Badge) => void
}

// Base UI's Select can't hold a real `null` item value alongside string ids, so an
// explicit sentinel represents "no kelurahan" and is converted to/from null at the edges.
const NO_KELURAHAN = "__none__"

const emptyForm = { name: "", category: "", description: "", type: "", kelurahanId: NO_KELURAHAN }

/** Create/edit sheet for a badge. Once the badge exists (editing, or just created), also manages its image. */
export function BadgeFormSheet({ open, onOpenChange, badge, onSaved }: Props) {
    const [savedBadge, setSavedBadge] = useState<Badge | null>(badge)
    const [form, setForm] = useState(emptyForm)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [kelurahans, setKelurahans] = useState<Kelurahan[] | null>(null)

    useEffect(() => {
        if (!open) return
        setSavedBadge(badge)
        setForm(
            badge
                ? {
                      name: badge.name,
                      category: badge.category,
                      description: badge.description,
                      type: badge.type,
                      kelurahanId: badge.kelurahanId ?? NO_KELURAHAN,
                  }
                : emptyForm
        )
        setError(null)
    }, [open, badge])

    useEffect(() => {
        if (!open) return
        let cancelled = false
        fetch("/api/kelurahan")
            .then((res) => res.json<{ kelurahans?: Kelurahan[] }>())
            .then((data) => {
                if (!cancelled) setKelurahans(data?.kelurahans ?? [])
            })
            .catch((err) => {
                if (!cancelled) {
                    console.error("Failed to load kelurahans:", err)
                    setKelurahans([])
                }
            })
        return () => {
            cancelled = true
        }
    }, [open])

    // Select.Value can't resolve a label from an unopened popup on its own — an
    // explicit items map lets it show the right label immediately.
    const kelurahanItems = useMemo(() => {
        const items: Record<string, string> = { [NO_KELURAHAN]: "No kelurahan" }
        for (const kelurahan of kelurahans ?? []) {
            items[kelurahan.id] = `${kelurahan.kelurahanName} (${kelurahan.kecamatanName})`
        }
        return items
    }, [kelurahans])

    const isEditing = savedBadge !== null

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!form.name.trim() || !form.category.trim() || !form.description.trim() || !form.type.trim()) {
            setError("All fields are required")
            return
        }

        setSaving(true)
        setError(null)
        try {
            const res = await fetch(isEditing ? `/api/badge/${savedBadge!.id}` : "/api/badge", {
                method: isEditing ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...form,
                    kelurahanId: form.kelurahanId === NO_KELURAHAN ? null : form.kelurahanId,
                }),
            })
            const data = await res.json<{ badge?: Badge; error?: string }>().catch(() => null)
            if (!res.ok || !data?.badge) {
                setError(data?.error ?? "Failed to save badge")
                return
            }
            setSavedBadge(data.badge)
            onSaved(data.badge)
        } catch (err) {
            console.error("Failed to save badge:", err)
            setError("Failed to save badge")
        } finally {
            setSaving(false)
        }
    }

    function handleImageChange(imageUrl: string | null) {
        if (!savedBadge) return
        const next = { ...savedBadge, imageUrl }
        setSavedBadge(next)
        onSaved(next)
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent>
                <SheetHeader>
                    <SheetTitle>{isEditing ? "Edit badge" : "New badge"}</SheetTitle>
                    <SheetDescription>
                        {isEditing ? "Update badge details and image." : "Create a badge, then add an image."}
                    </SheetDescription>
                </SheetHeader>

                <form id="badge-form" onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 overflow-y-auto px-6">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="badge-name">Name</Label>
                        <Input
                            id="badge-name"
                            value={form.name}
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            disabled={saving}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="badge-category">Category (any category you want)</Label>
                        <Input
                            id="badge-category"
                            value={form.category}
                            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                            disabled={saving}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="badge-type">Type (<span className="mono">`quest` or `once`</span>)</Label>
                        <Input
                            id="badge-type"
                            value={form.type}
                            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                            disabled={saving}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="badge-kelurahan">Kelurahan (optional)</Label>
                        <Select
                            value={form.kelurahanId}
                            onValueChange={(value) => setForm((f) => ({ ...f, kelurahanId: (value as string) ?? NO_KELURAHAN }))}
                            items={kelurahanItems}
                        >
                            <SelectTrigger id="badge-kelurahan" disabled={saving || kelurahans === null} className="w-full">
                                <SelectValue placeholder="No kelurahan" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_KELURAHAN}>No kelurahan</SelectItem>
                                {(kelurahans ?? []).map((kelurahan) => (
                                    <SelectItem key={kelurahan.id} value={kelurahan.id}>
                                        {kelurahan.kelurahanName} ({kelurahan.kecamatanName})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="badge-description">Description</Label>
                        <Textarea
                            id="badge-description"
                            value={form.description}
                            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                            disabled={saving}
                        />
                    </div>

                    {error && <p className="text-sm text-destructive">{error}</p>}

                    {savedBadge && (
                        <div className="flex flex-col gap-1.5 border-t border-border pt-4">
                            <Label>Image</Label>
                            <BadgeImage badgeId={savedBadge.id} imageUrl={savedBadge.imageUrl} onChange={handleImageChange} />
                        </div>
                    )}

                    {savedBadge && (
                        <div className="flex flex-col gap-1.5 border-t border-border pt-4">
                            <Label>Steps</Label>
                            <BadgeSteps badgeId={savedBadge.id} />
                        </div>
                    )}
                </form>

                <SheetFooter className="flex-row justify-end">
                    <SheetClose render={<Button variant="outline" type="button" />}>Close</SheetClose>
                    <Button type="submit" form="badge-form" disabled={saving}>
                        {saving ? "Saving…" : isEditing ? "Save changes" : "Create badge"}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
