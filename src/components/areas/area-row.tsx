"use client"

import { PencilIcon, Trash2Icon } from "lucide-react"

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Area } from "@/lib/area"

type Props = {
    area: Area
    onEdit: () => void
    onDelete: () => void
}

export function AreaRow({ area, onEdit, onDelete }: Props) {
    const coverUrl = area.photoUrl ?? area.thumbnails[0]?.url
    const categories = area.category?.split(",").map((c) => c.trim()).filter(Boolean) ?? []

    return (
        <div className="flex items-center gap-4 px-4 py-3">
            <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                {coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverUrl} alt="" className="size-full object-cover" />
                ) : (
                    <div className="flex size-full items-center justify-center text-[10px] text-muted-foreground">No image</div>
                )}
            </div>
            <div className="min-w-0 flex-1">
                <span className="truncate font-medium">{area.name}</span>
                <p className="truncate text-sm text-muted-foreground">
                    {area.lat.toFixed(5)}, {area.lng.toFixed(5)}
                </p>
                {area.description && <p className="truncate text-sm text-muted-foreground">{area.description}</p>}
                {(area.label || categories.length > 0) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                        {area.label && <Badge>{area.label}</Badge>}
                        {categories.map((c) => (
                            <Badge key={c} variant="secondary">
                                {c}
                            </Badge>
                        ))}
                    </div>
                )}
            </div>
            <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" onClick={onEdit}>
                    <PencilIcon /> Edit
                </Button>
                <AlertDialog>
                    <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
                        <Trash2Icon /> Delete
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete &quot;{area.name}&quot;?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Kelurahans mapped to this area will have it cleared. This can&apos;t be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={onDelete}>
                                Delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    )
}
