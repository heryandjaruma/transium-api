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
import { KelurahanThumbnails } from "@/components/kelurahans/kelurahan-thumbnails"
import type { Kelurahan } from "@/lib/kelurahan"

type Props = {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** `null` opens the sheet in create mode. */
    kelurahan: Kelurahan | null
    onSaved: (kelurahan: Kelurahan) => void
}

const emptyForm = { kelurahanName: "", kecamatanName: "", description: "", category: "" }

/** Create/edit sheet for a kelurahan. Once the kelurahan exists (editing, or just created), also manages its thumbnails. */
export function KelurahanFormSheet({ open, onOpenChange, kelurahan, onSaved }: Props) {
    const [savedKelurahan, setSavedKelurahan] = useState<Kelurahan | null>(kelurahan)
    const [form, setForm] = useState(emptyForm)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        setSavedKelurahan(kelurahan)
        setForm(
            kelurahan
                ? {
                      kelurahanName: kelurahan.kelurahanName,
                      kecamatanName: kelurahan.kecamatanName,
                      description: kelurahan.description ?? "",
                      category: kelurahan.category ?? "",
                  }
                : emptyForm
        )
        setError(null)
    }, [open, kelurahan])

    const isEditing = savedKelurahan !== null

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!form.kelurahanName.trim() || !form.kecamatanName.trim()) {
            setError("Kelurahan name and kecamatan name are required")
            return
        }

        setSaving(true)
        setError(null)
        try {
            const body = {
                kelurahanName: form.kelurahanName.trim(),
                kecamatanName: form.kecamatanName.trim(),
                description: form.description.trim() || null,
                category: form.category.trim() || null,
            }
            const res = await fetch(isEditing ? `/api/kelurahan/${savedKelurahan!.id}` : "/api/kelurahan", {
                method: isEditing ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })
            const data = await res.json<{ kelurahan?: Kelurahan; error?: string }>().catch(() => null)
            if (!res.ok || !data?.kelurahan) {
                setError(data?.error ?? "Failed to save kelurahan")
                return
            }
            setSavedKelurahan(data.kelurahan)
            onSaved(data.kelurahan)
        } catch (err) {
            console.error("Failed to save kelurahan:", err)
            setError("Failed to save kelurahan")
        } finally {
            setSaving(false)
        }
    }

    function handleThumbnailsChange(thumbnails: Kelurahan["thumbnails"]) {
        if (!savedKelurahan) return
        const next = { ...savedKelurahan, thumbnails }
        setSavedKelurahan(next)
        onSaved(next)
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent>
                <SheetHeader>
                    <SheetTitle>{isEditing ? "Edit kelurahan" : "New kelurahan"}</SheetTitle>
                    <SheetDescription>
                        {isEditing ? "Update kelurahan details and thumbnails." : "Create a kelurahan, then add thumbnails."}
                    </SheetDescription>
                </SheetHeader>

                <form id="kelurahan-form" onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 overflow-y-auto px-6">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="kelurahan-name">Kelurahan name</Label>
                        <Input
                            id="kelurahan-name"
                            value={form.kelurahanName}
                            onChange={(e) => setForm((f) => ({ ...f, kelurahanName: e.target.value }))}
                            disabled={saving}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="kecamatan-name">Kecamatan name</Label>
                        <Input
                            id="kecamatan-name"
                            value={form.kecamatanName}
                            onChange={(e) => setForm((f) => ({ ...f, kecamatanName: e.target.value }))}
                            disabled={saving}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="kelurahan-description">Description</Label>
                        <Textarea
                            id="kelurahan-description"
                            value={form.description}
                            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                            placeholder="A catchy phrase for this kelurahan"
                            disabled={saving}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="kelurahan-category">Category</Label>
                        <Input
                            id="kelurahan-category"
                            value={form.category}
                            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                            placeholder="e.g. Beach,Mountains"
                            disabled={saving}
                        />
                        <p className="text-xs text-muted-foreground">Comma-separated majority destination types.</p>
                    </div>

                    {error && <p className="text-sm text-destructive">{error}</p>}

                    {savedKelurahan && (
                        <div className="flex flex-col gap-1.5 border-t border-border pt-4">
                            <Label>Thumbnails</Label>
                            <KelurahanThumbnails
                                kelurahanId={savedKelurahan.id}
                                thumbnails={savedKelurahan.thumbnails}
                                onChange={handleThumbnailsChange}
                            />
                        </div>
                    )}
                </form>

                <SheetFooter className="flex-row justify-end">
                    <SheetClose render={<Button variant="outline" type="button" />}>Close</SheetClose>
                    <Button type="submit" form="kelurahan-form" disabled={saving}>
                        {saving ? "Saving…" : isEditing ? "Save changes" : "Create kelurahan"}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
