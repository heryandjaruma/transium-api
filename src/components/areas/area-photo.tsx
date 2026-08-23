"use client"

import { useRef, useState } from "react"
import { ImagePlusIcon, Loader2Icon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/gif"

type Props = {
    areaId: string
    photoUrl: string | null
    onChange: (photoUrl: string | null) => void
}

/** Upload/replace/remove an area's single hero photo, shown before the area's details. Uploads go straight to R2 via /api/area/photo. */
export function AreaPhoto({ areaId, photoUrl, onChange }: Props) {
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
            formData.append("areaId", areaId)
            formData.append("file", file)

            const res = await fetch("/api/area/photo", { method: "POST", body: formData })
            const data = await res.json<{ photoUrl?: string; error?: string }>().catch(() => null)
            if (!res.ok || !data?.photoUrl) {
                setError(data?.error ?? "Failed to upload photo")
                return
            }
            onChange(data.photoUrl)
        } catch (err) {
            console.error("Failed to upload area photo:", err)
            setError("Failed to upload photo")
        } finally {
            setUploading(false)
        }
    }

    async function handleRemove() {
        setRemoving(true)
        setError(null)
        try {
            const res = await fetch(`/api/area/photo?areaId=${areaId}`, { method: "DELETE" })
            if (!res.ok && res.status !== 204) {
                const data = await res.json<{ error?: string }>().catch(() => null)
                setError(data?.error ?? "Failed to remove photo")
                return
            }
            onChange(null)
        } catch (err) {
            console.error("Failed to remove area photo:", err)
            setError("Failed to remove photo")
        } finally {
            setRemoving(false)
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
                <div className="group relative size-20 shrink-0 overflow-hidden rounded-xl ring-1 ring-foreground/10">
                    {photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photoUrl} alt="" className="size-full object-cover" />
                    ) : (
                        <div className="flex size-full items-center justify-center bg-muted text-muted-foreground">
                            <ImagePlusIcon className="size-4" />
                        </div>
                    )}
                    {photoUrl && (
                        <button
                            type="button"
                            onClick={handleRemove}
                            disabled={removing}
                            className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
                            aria-label="Remove photo"
                        >
                            {removing ? <Loader2Icon className="size-3 animate-spin" /> : <XIcon className="size-3" />}
                        </button>
                    )}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
                    {uploading ? "Uploading…" : photoUrl ? "Replace" : "Upload"}
                </Button>
                <input ref={inputRef} type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={handleFileSelected} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
    )
}
