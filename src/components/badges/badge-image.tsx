"use client"

import { useRef, useState } from "react"
import { ImagePlusIcon, Loader2Icon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/gif"

type Props = {
    badgeId: string
    imageUrl: string | null
    onChange: (imageUrl: string | null) => void
}

/** Upload/replace/remove a badge's single thumbnail image. Uploads go straight to R2 via /api/badge/media. */
export function BadgeImage({ badgeId, imageUrl, onChange }: Props) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [uploading, setUploading] = useState(false)
    const [removing, setRemoving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        e.target.value = ""
        if (!file) return

        setUploading(true)
        setError(null)
        try {
            const formData = new FormData()
            formData.append("badgeId", badgeId)
            formData.append("file", file)

            const res = await fetch("/api/badge/media", { method: "POST", body: formData })
            const data = await res.json<{ imageUrl?: string; error?: string }>().catch(() => null)
            if (!res.ok || !data?.imageUrl) {
                setError(data?.error ?? "Failed to upload image")
                return
            }
            onChange(data.imageUrl)
        } catch (err) {
            console.error("Failed to upload badge image:", err)
            setError("Failed to upload image")
        } finally {
            setUploading(false)
        }
    }

    async function handleRemove() {
        setRemoving(true)
        setError(null)
        try {
            const res = await fetch(`/api/badge/media?badgeId=${badgeId}`, { method: "DELETE" })
            if (!res.ok && res.status !== 204) {
                const data = await res.json<{ error?: string }>().catch(() => null)
                setError(data?.error ?? "Failed to remove image")
                return
            }
            onChange(null)
        } catch (err) {
            console.error("Failed to remove badge image:", err)
            setError("Failed to remove image")
        } finally {
            setRemoving(false)
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
                <div className="group relative size-20 shrink-0 overflow-hidden rounded-xl ring-1 ring-foreground/10">
                    {imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imageUrl} alt="" className="size-full object-cover" />
                    ) : (
                        <div className="flex size-full items-center justify-center bg-muted text-muted-foreground">
                            <ImagePlusIcon className="size-4" />
                        </div>
                    )}
                    {imageUrl && (
                        <button
                            type="button"
                            onClick={handleRemove}
                            disabled={removing}
                            className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
                            aria-label="Remove image"
                        >
                            {removing ? <Loader2Icon className="size-3 animate-spin" /> : <XIcon className="size-3" />}
                        </button>
                    )}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
                    {uploading ? "Uploading…" : imageUrl ? "Replace" : "Upload"}
                </Button>
                <input ref={inputRef} type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={handleFileSelected} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
    )
}
