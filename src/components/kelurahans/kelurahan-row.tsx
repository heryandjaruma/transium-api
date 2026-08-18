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
import { Button } from "@/components/ui/button"
import type { Kelurahan } from "@/lib/kelurahan"

type Props = {
    kelurahan: Kelurahan
    onEdit: () => void
    onDelete: () => void
}

export function KelurahanRow({ kelurahan, onEdit, onDelete }: Props) {
    return (
        <div className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
                <span className="truncate font-medium">{kelurahan.kelurahanName}</span>
                <p className="truncate text-sm text-muted-foreground">{kelurahan.kecamatanName}</p>
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
