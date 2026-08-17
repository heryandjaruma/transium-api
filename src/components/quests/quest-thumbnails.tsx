"use client"

import { useRef, useState } from "react"
import { ImagePlusIcon, Loader2Icon, XIcon } from "lucide-react"

import type { QuestMedia } from "@/lib/quest"

const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/gif"

type Props = {
    questId: string
    thumbnails: QuestMedia[]
    onChange: (thumbnails: QuestMedia[]) => void
}

/** Upload/remove thumbnails for a quest. Uploads go straight to R2 via /api/quest/media. */
export function QuestThumbnails({ questId, thumbnails, onChange }: Props) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [uploading, setUploading] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

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

            const res = await fetch("/api/quest/media", { method: "POST", body: formData })
            const data = await res.json<{ media?: QuestMedia; error?: string }>().catch(() => null)
            if (!res.ok || !data?.media) {
                setError(data?.error ?? "Failed to upload thumbnail")
                return
            }
            onChange([...thumbnails, data.media])
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
        } catch (err) {
            console.error("Failed to remove thumbnail:", err)
            setError("Failed to remove thumbnail")
        } finally {
            setDeletingId(null)
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
                {thumbnails.map((media) => (
                    <div key={media.id} className="group relative size-20 overflow-hidden rounded-xl ring-1 ring-foreground/10">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={media.url} alt="" className="size-full object-cover" />
                        <button
                            type="button"
                            onClick={() => handleDelete(media.id)}
                            disabled={deletingId === media.id}
                            className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
                            aria-label="Remove thumbnail"
                        >
                            {deletingId === media.id ? <Loader2Icon className="size-3 animate-spin" /> : <XIcon className="size-3" />}
                        </button>
                    </div>
                ))}

                <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={uploading}
                    className="flex size-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-input text-muted-foreground transition-colors hover:border-ring hover:text-foreground disabled:opacity-50"
                >
                    {uploading ? <Loader2Icon className="size-4 animate-spin" /> : <ImagePlusIcon className="size-4" />}
                    <span className="text-xs">{uploading ? "Uploading…" : "Add"}</span>
                </button>
                <input ref={inputRef} type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={handleFileSelected} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
    )
}
