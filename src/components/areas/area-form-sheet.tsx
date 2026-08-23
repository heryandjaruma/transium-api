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
import { AreaKelurahanMapper } from "@/components/areas/area-kelurahan-mapper"
import { AreaThumbnails } from "@/components/areas/area-thumbnails"
import type { Area } from "@/lib/area"

type Props = {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** `null` opens the sheet in create mode. */
    area: Area | null
    onSaved: (area: Area) => void
}

const emptyForm = { name: "", description: "", category: "", lat: "", lng: "" }

/** Create/edit sheet for an area. Once the area exists (editing, or just created), also manages its thumbnails and kelurahan membership. */
export function AreaFormSheet({ open, onOpenChange, area, onSaved }: Props) {
    const [savedArea, setSavedArea] = useState<Area | null>(area)
    const [form, setForm] = useState(emptyForm)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        setSavedArea(area)
        setForm(
            area
                ? {
                      name: area.name,
                      description: area.description ?? "",
                      category: area.category ?? "",
                      lat: String(area.lat),
                      lng: String(area.lng),
                  }
                : emptyForm
        )
        setError(null)
    }, [open, area])

    const isEditing = savedArea !== null

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!form.name.trim()) {
            setError("Name is required")
            return
        }
        const lat = Number(form.lat)
        const lng = Number(form.lng)
        if (form.lat.trim() === "" || !Number.isFinite(lat) || form.lng.trim() === "" || !Number.isFinite(lng)) {
            setError("Lat/lng must be valid numbers")
            return
        }

        setSaving(true)
        setError(null)
        try {
            const body = {
                name: form.name.trim(),
                lat,
                lng,
                description: form.description.trim() || null,
                category: form.category.trim() || null,
            }
            const res = await fetch(isEditing ? `/api/area/${savedArea!.id}` : "/api/area", {
                method: isEditing ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })
            const data = await res.json<{ area?: Area; error?: string }>().catch(() => null)
            if (!res.ok || !data?.area) {
                setError(data?.error ?? "Failed to save area")
                return
            }
            setSavedArea(data.area)
            onSaved(data.area)
        } catch (err) {
            console.error("Failed to save area:", err)
            setError("Failed to save area")
        } finally {
            setSaving(false)
        }
    }

    function handleThumbnailsChange(thumbnails: Area["thumbnails"]) {
        if (!savedArea) return
        const next = { ...savedArea, thumbnails }
        setSavedArea(next)
        onSaved(next)
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent>
                <SheetHeader>
                    <SheetTitle>{isEditing ? "Edit area" : "New area"}</SheetTitle>
                    <SheetDescription>
                        {isEditing ? "Update area details, thumbnails, and kelurahan membership." : "Create an area, then add thumbnails and map kelurahans to it."}
                    </SheetDescription>
                </SheetHeader>

                <form id="area-form" onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 overflow-y-auto px-6">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="area-name">Name</Label>
                        <Input
                            id="area-name"
                            value={form.name}
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            disabled={saving}
                        />
                    </div>
                    <div className="flex gap-3">
                        <div className="flex flex-1 flex-col gap-1.5">
                            <Label htmlFor="area-lat">Latitude</Label>
                            <Input
                                id="area-lat"
                                type="number"
                                step="any"
                                value={form.lat}
                                onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
                                disabled={saving}
                            />
                        </div>
                        <div className="flex flex-1 flex-col gap-1.5">
                            <Label htmlFor="area-lng">Longitude</Label>
                            <Input
                                id="area-lng"
                                type="number"
                                step="any"
                                value={form.lng}
                                onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
                                disabled={saving}
                            />
                        </div>
                    </div>
                    <p className="-mt-2 text-xs text-muted-foreground">Center point, used to estimate distance to this area.</p>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="area-description">Description</Label>
                        <Textarea
                            id="area-description"
                            value={form.description}
                            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                            placeholder="A catchy phrase for this area"
                            disabled={saving}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="area-category">Category</Label>
                        <Input
                            id="area-category"
                            value={form.category}
                            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                            placeholder="e.g. Beach,Mountains"
                            disabled={saving}
                        />
                        <p className="text-xs text-muted-foreground">Comma-separated majority destination types.</p>
                    </div>

                    {error && <p className="text-sm text-destructive">{error}</p>}

                    {savedArea && (
                        <div className="flex flex-col gap-1.5 border-t border-border pt-4">
                            <Label>Thumbnails</Label>
                            <AreaThumbnails areaId={savedArea.id} thumbnails={savedArea.thumbnails} onChange={handleThumbnailsChange} />
                        </div>
                    )}

                    {savedArea && (
                        <div className="flex flex-col gap-1.5 border-t border-border pt-4">
                            <Label>Kelurahans in this area</Label>
                            <AreaKelurahanMapper areaId={savedArea.id} />
                        </div>
                    )}
                </form>

                <SheetFooter className="flex-row justify-end">
                    <SheetClose render={<Button variant="outline" type="button" />}>Close</SheetClose>
                    <Button type="submit" form="area-form" disabled={saving}>
                        {saving ? "Saving…" : isEditing ? "Save changes" : "Create area"}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
