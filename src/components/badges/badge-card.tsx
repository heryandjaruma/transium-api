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
import { Badge as BadgePill } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import type { Badge } from "@/lib/badge"

type Props = {
    badge: Badge
    onEdit: () => void
    onDelete: () => void
}

export function BadgeCard({ badge, onEdit, onDelete }: Props) {
    return (
        <Card size="sm" className="gap-3">
            <div className="aspect-video w-full overflow-hidden rounded-t-xl bg-muted">
                {badge.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={badge.imageUrl} alt="" className="size-full object-cover" />
                ) : (
                    <div className="flex size-full items-center justify-center text-xs text-muted-foreground">No image</div>
                )}
            </div>
            <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                    <span className="truncate">{badge.name}</span>
                    <div className="flex shrink-0 gap-1">
                        <BadgePill variant="outline">{badge.category}</BadgePill>
                        <BadgePill variant="secondary">{badge.type}</BadgePill>
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <p className="line-clamp-2 text-muted-foreground">{badge.description}</p>
            </CardContent>
            <CardFooter className="justify-end gap-2">
                <Button variant="outline" size="sm" onClick={onEdit}>
                    <PencilIcon /> Edit
                </Button>
                <AlertDialog>
                    <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
                        <Trash2Icon /> Delete
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete &quot;{badge.name}&quot;?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This removes the badge and its image. This can&apos;t be undone.
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
            </CardFooter>
        </Card>
    )
}
