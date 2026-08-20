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
import type { Kelurahan } from "@/lib/kelurahan"

type Props = {
    kelurahan: Kelurahan
    onEdit: () => void
    onDelete: () => void
}

export function KelurahanRow({ kelurahan, onEdit, onDelete }: Props) {
    const thumbnail = kelurahan.thumbnails[0]
    const categories = kelurahan.category?.split(",").map((c) => c.trim()).filter(Boolean) ?? []

    return (
        <div className="flex items-center gap-4 px-4 py-3">
            <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                {thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbnail.url} alt="" className="size-full object-cover" />
                ) : (
                    <div className="flex size-full items-center justify-center text-[10px] text-muted-foreground">No image</div>
                )}
            </div>
            <div className="min-w-0 flex-1">
                <span className="truncate font-medium">{kelurahan.kelurahanName}</span>
                <p className="truncate text-sm text-muted-foreground">{kelurahan.kecamatanName}</p>
                {kelurahan.description && <p className="truncate text-sm text-muted-foreground">{kelurahan.description}</p>}
                {categories.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
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
                            <AlertDialogTitle>Delete &quot;{kelurahan.kelurahanName}&quot;?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Badges referencing this kelurahan will have it cleared. This can&apos;t be undone.
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
