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
import type { Kelurahan } from "@/lib/kelurahan"

type Props = {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** `null` opens the sheet in create mode. */
    kelurahan: Kelurahan | null
    onSaved: (kelurahan: Kelurahan) => void
}

const emptyForm = { kelurahanName: "", kecamatanName: "" }

/** Create/edit sheet for a kelurahan — no nested resources, so it closes itself on save. */
export function KelurahanFormSheet({ open, onOpenChange, kelurahan, onSaved }: Props) {
    const [form, setForm] = useState(emptyForm)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const isEditing = kelurahan !== null

    useEffect(() => {
        if (!open) return
        setForm(kelurahan ? { kelurahanName: kelurahan.kelurahanName, kecamatanName: kelurahan.kecamatanName } : emptyForm)
        setError(null)
    }, [open, kelurahan])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!form.kelurahanName.trim() || !form.kecamatanName.trim()) {
            setError("All fields are required")
            return
        }

        setSaving(true)
        setError(null)
        try {
            const res = await fetch(isEditing ? `/api/kelurahan/${kelurahan!.id}` : "/api/kelurahan", {
                method: isEditing ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            })
            const data = await res.json<{ kelurahan?: Kelurahan; error?: string }>().catch(() => null)
            if (!res.ok || !data?.kelurahan) {
                setError(data?.error ?? "Failed to save kelurahan")
                return
            }
            onSaved(data.kelurahan)
            onOpenChange(false)
        } catch (err) {
            console.error("Failed to save kelurahan:", err)
            setError("Failed to save kelurahan")
        } finally {
            setSaving(false)
        }
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent>
                <SheetHeader>
                    <SheetTitle>{isEditing ? "Edit kelurahan" : "New kelurahan"}</SheetTitle>
                    <SheetDescription>
                        {isEditing ? "Update this kelurahan." : "Add a kelurahan badges can be scoped to."}
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

                    {error && <p className="text-sm text-destructive">{error}</p>}
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
