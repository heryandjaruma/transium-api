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
import type { ActionDefinition } from "@/lib/action-definition"

type Props = {
    action: ActionDefinition
    onEdit: () => void
    onDelete: () => void
}

export function ActionDefinitionRow({ action, onEdit, onDelete }: Props) {
    return (
        <div className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{action.name}</span>
                    <Badge variant="outline">{action.type}</Badge>
                </div>
                <p className="truncate text-sm text-muted-foreground">{action.description}</p>
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
                            <AlertDialogTitle>Delete &quot;{action.name}&quot;?</AlertDialogTitle>
                            <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
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
