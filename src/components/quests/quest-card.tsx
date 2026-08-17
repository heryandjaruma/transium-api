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
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import type { Quest } from "@/lib/quest"

type Props = {
    quest: Quest
    onEdit: () => void
    onDelete: () => void
}

export function QuestCard({ quest, onEdit, onDelete }: Props) {
    const thumbnail = quest.thumbnails[0]

    return (
        <Card size="sm" className="gap-3">
            <div className="aspect-video w-full overflow-hidden rounded-t-xl bg-muted">
                {thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbnail.url} alt="" className="size-full object-cover" />
                ) : (
                    <div className="flex size-full items-center justify-center text-xs text-muted-foreground">No thumbnail</div>
                )}
            </div>
            <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                    <span className="truncate">{quest.name}</span>
                    <Badge variant="outline">{quest.category}</Badge>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <p className="line-clamp-2 text-muted-foreground">{quest.description}</p>
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
                            <AlertDialogTitle>Delete &quot;{quest.name}&quot;?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This removes the quest and its thumbnails. This can&apos;t be undone.
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
