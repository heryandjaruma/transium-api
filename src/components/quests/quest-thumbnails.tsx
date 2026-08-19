"use client"

import { useRef, useState } from "react"
import { CheckIcon, ImagePlusIcon, Loader2Icon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { QuestMedia } from "@/lib/quest"

const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/gif"

type Props = {
    questId: string
    thumbnails: QuestMedia[]
    onChange: (thumbnails: QuestMedia[]) => void
}

/** Upload/remove thumbnails for a quest, and edit each one's alt text and copyright. Uploads go straight to R2 via /api/quest/media. */
export function QuestThumbnails({ questId, thumbnails, onChange }: Props) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [uploading, setUploading] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [savingId, setSavingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const [pendingAlt, setPendingAlt] = useState("")
    const [pendingCopyright, setPendingCopyright] = useState("")

    const [edits, setEdits] = useState<Record<string, { alt: string; copyright: string }>>({})

    function fieldsFor(media: QuestMedia) {
        return edits[media.id] ?? { alt: media.alt ?? "", copyright: media.copyright ?? "" }
    }

    function isDirty(media: QuestMedia) {
        const f = fieldsFor(media)
        return f.alt !== (media.alt ?? "") || f.copyright !== (media.copyright ?? "")
    }

    function updateField(mediaId: string, media: QuestMedia, patch: Partial<{ alt: string; copyright: string }>) {
        setEdits((prev) => ({
            ...prev,
            [mediaId]: { ...(prev[mediaId] ?? { alt: media.alt ?? "", copyright: media.copyright ?? "" }), ...patch },
        }))
    }

    async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        e.target.value = ""
        if (!file) return

        setUploading(true)
        setError(null)
        try {
            const formData = new FormData()
            formData.append("questId", questId)
            formData.append("file", file)
            if (pendingAlt.trim()) formData.append("alt", pendingAlt.trim())
            if (pendingCopyright.trim()) formData.append("copyright", pendingCopyright.trim())

            const res = await fetch("/api/quest/media", { method: "POST", body: formData })
            const data = await res.json<{ media?: QuestMedia; error?: string }>().catch(() => null)
            if (!res.ok || !data?.media) {
                setError(data?.error ?? "Failed to upload thumbnail")
                return
            }
            onChange([...thumbnails, data.media])
            setPendingAlt("")
            setPendingCopyright("")
        } catch (err) {
            console.error("Failed to upload thumbnail:", err)
            setError("Failed to upload thumbnail")
        } finally {
            setUploading(false)
        }
    }

    async function handleDelete(mediaId: string) {
        setDeletingId(mediaId)
        setError(null)
        try {
            const res = await fetch(`/api/quest/media?questId=${questId}&mediaId=${mediaId}`, { method: "DELETE" })
            if (!res.ok && res.status !== 204) {
                const data = await res.json<{ error?: string }>().catch(() => null)
                setError(data?.error ?? "Failed to remove thumbnail")
                return
            }
            onChange(thumbnails.filter((m) => m.id !== mediaId))
            setEdits((prev) => {
                const next = { ...prev }
                delete next[mediaId]
                return next
            })
        } catch (err) {
            console.error("Failed to remove thumbnail:", err)
            setError("Failed to remove thumbnail")
        } finally {
            setDeletingId(null)
        }
    }

    async function handleSave(media: QuestMedia) {
        const f = fieldsFor(media)
        setSavingId(media.id)
        setError(null)
        try {
            const res = await fetch("/api/quest/media", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    questId,
                    mediaId: media.id,
                    alt: f.alt.trim() || null,
                    copyright: f.copyright.trim() || null,
                }),
            })
            const data = await res.json<{ media?: QuestMedia; error?: string }>().catch(() => null)
            if (!res.ok || !data?.media) {
                setError(data?.error ?? "Failed to save thumbnail details")
                return
            }
            onChange(thumbnails.map((m) => (m.id === media.id ? data.media! : m)))
            setEdits((prev) => {
                const next = { ...prev }
                delete next[media.id]
                return next
            })
        } catch (err) {
            console.error("Failed to save thumbnail details:", err)
            setError("Failed to save thumbnail details")
        } finally {
            setSavingId(null)
        }
    }

    return (
        <div className="flex flex-col gap-3">
            {thumbnails.length > 0 && (
                <div className="flex flex-col divide-y divide-border rounded-xl ring-1 ring-foreground/10">
                    {thumbnails.map((media) => {
                        const f = fieldsFor(media)
                        const dirty = isDirty(media)
                        return (
                            <div key={media.id} className="flex items-start gap-3 p-3">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={media.url} alt={media.alt ?? ""} className="size-16 shrink-0 rounded-lg object-cover ring-1 ring-foreground/10" />
                                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                    <Input
                                        value={f.alt}
                                        onChange={(e) => updateField(media.id, media, { alt: e.target.value })}
                                        placeholder="Alt text (for accessibility)"
                                        disabled={savingId === media.id}
                                        aria-label="Alt text"
                                    />
                                    <Input
                                        value={f.copyright}
                                        onChange={(e) => updateField(media.id, media, { copyright: e.target.value })}
                                        placeholder="Copyright / attribution"
                                        disabled={savingId === media.id}
                                        aria-label="Copyright"
                                    />
                                </div>
                                <div className="flex shrink-0 flex-col gap-1">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={() => handleSave(media)}
                                        disabled={!dirty || savingId === media.id}
                                        aria-label="Save thumbnail details"
                                    >
                                        {savingId === media.id ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={() => handleDelete(media.id)}
                                        disabled={deletingId === media.id}
                                        aria-label="Remove thumbnail"
                                    >
                                        {deletingId === media.id ? <Loader2Icon className="animate-spin" /> : <XIcon />}
                                    </Button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            <div className="flex flex-col gap-1.5 rounded-xl border border-dashed border-input p-3">
                <div className="flex flex-col gap-1.5 sm:flex-row">
                    <Input
                        value={pendingAlt}
                        onChange={(e) => setPendingAlt(e.target.value)}
                        placeholder="Alt text (optional)"
                        disabled={uploading}
                        aria-label="Alt text for next upload"
                    />
                    <Input
                        value={pendingCopyright}
                        onChange={(e) => setPendingCopyright(e.target.value)}
                        placeholder="Copyright / attribution (optional)"
                        disabled={uploading}
                        aria-label="Copyright for next upload"
                    />
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
                    {uploading ? <Loader2Icon className="animate-spin" /> : <ImagePlusIcon />}
                    {uploading ? "Uploading…" : "Add thumbnail"}
                </Button>
                <input ref={inputRef} type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={handleFileSelected} />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
    )
}
