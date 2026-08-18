"use client"

import { useEffect, useState } from "react"
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ActionDefinition } from "@/lib/action-definition"
import type { BadgeActionStep } from "@/lib/badge-action"

type Props = {
    badgeId: string
}

type StepForm = {
    actionId: string
    sequence: string
    lat: string
    lng: string
    instruction: string
}

function nextSequenceFor(steps: BadgeActionStep[]) {
    return steps.length ? Math.max(...steps.map((s) => s.sequence)) + 1 : 1
}

function emptyStepForm(sequence: number): StepForm {
    return { actionId: "", sequence: String(sequence), lat: "", lng: "", instruction: "" }
}

function stepToForm(step: BadgeActionStep): StepForm {
    return {
        actionId: step.actionId,
        sequence: String(step.sequence),
        lat: step.lat !== null ? String(step.lat) : "",
        lng: step.lng !== null ? String(step.lng) : "",
        instruction: step.instruction ?? "",
    }
}

/** Manage a badge's ordered steps (BadgeAction rows), each pointing at an ActionDefinition. */
export function BadgeSteps({ badgeId }: Props) {
    const [steps, setSteps] = useState<BadgeActionStep[] | null>(null)
    const [actionDefinitions, setActionDefinitions] = useState<ActionDefinition[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [adding, setAdding] = useState(false)
    const [form, setForm] = useState<StepForm>(emptyStepForm(1))

    useEffect(() => {
        let cancelled = false

        async function load() {
            try {
                const [stepsRes, actionsRes] = await Promise.all([
                    fetch(`/api/badge/${badgeId}/actions`),
                    fetch("/api/action-definition"),
                ])
                const stepsData = await stepsRes.json<{ steps?: BadgeActionStep[]; error?: string }>().catch(() => null)
                const actionsData = await actionsRes.json<{ actionDefinitions?: ActionDefinition[] }>().catch(() => null)
                if (cancelled) return

                if (!stepsRes.ok || !stepsData?.steps) {
                    setError(stepsData?.error ?? "Failed to load steps")
                } else {
                    setSteps(stepsData.steps)
                }
                setActionDefinitions(actionsData?.actionDefinitions ?? [])
            } catch (err) {
                if (cancelled) return
                console.error("Failed to load badge steps:", err)
                setError("Failed to load steps")
            }
        }

        load()
        return () => {
            cancelled = true
        }
    }, [badgeId])

    function startAdd() {
        setEditingId(null)
        setError(null)
        setForm(emptyStepForm(nextSequenceFor(steps ?? [])))
        setAdding(true)
    }

    function startEdit(step: BadgeActionStep) {
        setAdding(false)
        setError(null)
        setForm(stepToForm(step))
        setEditingId(step.id)
    }

    function cancelForm() {
        setAdding(false)
        setEditingId(null)
        setError(null)
    }

    function buildPayload() {
        const sequence = Number(form.sequence)
        if (!form.actionId || !Number.isFinite(sequence)) return null
        return {
            actionId: form.actionId,
            sequence,
            lat: form.lat.trim() ? Number(form.lat) : null,
            lng: form.lng.trim() ? Number(form.lng) : null,
            instruction: form.instruction.trim() || null,
        }
    }

    async function handleAdd() {
        const payload = buildPayload()
        if (!payload) {
            setError("Pick an action and a valid sequence")
            return
        }

        setSaving(true)
        setError(null)
        try {
            const res = await fetch(`/api/badge/${badgeId}/actions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })
            const data = await res.json<{ step?: BadgeActionStep; error?: string }>().catch(() => null)
            if (!res.ok || !data?.step) {
                setError(data?.error ?? "Failed to add step")
                return
            }
            setSteps((prev) => [...(prev ?? []), data.step!].sort((a, b) => a.sequence - b.sequence))
            setAdding(false)
        } catch (err) {
            console.error("Failed to add badge step:", err)
            setError("Failed to add step")
        } finally {
            setSaving(false)
        }
    }

    async function handleUpdate(stepId: string) {
        const payload = buildPayload()
        if (!payload) {
            setError("Pick an action and a valid sequence")
            return
        }

        setSaving(true)
        setError(null)
        try {
            const res = await fetch(`/api/badge/${badgeId}/actions/${stepId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })
            const data = await res.json<{ step?: BadgeActionStep; error?: string }>().catch(() => null)
            if (!res.ok || !data?.step) {
                setError(data?.error ?? "Failed to update step")
                return
            }
            setSteps((prev) => (prev ?? []).map((s) => (s.id === stepId ? data.step! : s)).sort((a, b) => a.sequence - b.sequence))
            setEditingId(null)
        } catch (err) {
            console.error("Failed to update badge step:", err)
            setError("Failed to update step")
        } finally {
            setSaving(false)
        }
    }

    async function handleDelete(stepId: string) {
        setDeletingId(stepId)
        setError(null)
        try {
            const res = await fetch(`/api/badge/${badgeId}/actions/${stepId}`, { method: "DELETE" })
            if (!res.ok && res.status !== 204) {
                const data = await res.json<{ error?: string }>().catch(() => null)
                setError(data?.error ?? "Failed to remove step")
                return
            }
            setSteps((prev) => (prev ?? []).filter((s) => s.id !== stepId))
        } catch (err) {
            console.error("Failed to remove badge step:", err)
            setError("Failed to remove step")
        } finally {
            setDeletingId(null)
        }
    }

    const isFormOpen = adding || editingId !== null

    return (
        <div className="flex flex-col gap-2">
            {steps === null ? (
                <p className="text-sm text-muted-foreground">Loading steps…</p>
            ) : (
                <>
                    {(steps.length > 0 || isFormOpen) && (
                        <div className="flex flex-col divide-y divide-border rounded-xl ring-1 ring-foreground/10">
                            {steps.map((step) =>
                                editingId === step.id ? (
                                    <StepFormRow
                                        key={step.id}
                                        form={form}
                                        setForm={setForm}
                                        actionDefinitions={actionDefinitions ?? []}
                                        saving={saving}
                                        onCancel={cancelForm}
                                        onSubmit={() => handleUpdate(step.id)}
                                        submitLabel="Save"
                                    />
                                ) : (
                                    <div key={step.id} className="flex items-center gap-3 px-3 py-2">
                                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                                            {step.sequence}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate text-sm font-medium">{step.actionName}</span>
                                                <span className="text-xs text-muted-foreground">{step.actionType}</span>
                                            </div>
                                            {(step.instruction || step.lat !== null) && (
                                                <p className="truncate text-xs text-muted-foreground">
                                                    {step.instruction}
                                                    {step.lat !== null && step.lng !== null ? ` (${step.lat}, ${step.lng})` : ""}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex shrink-0 gap-1">
                                            <Button type="button" variant="ghost" size="icon-sm" onClick={() => startEdit(step)}>
                                                <PencilIcon />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={() => handleDelete(step.id)}
                                                disabled={deletingId === step.id}
                                            >
                                                <Trash2Icon />
                                            </Button>
                                        </div>
                                    </div>
                                )
                            )}
                            {adding && (
                                <StepFormRow
                                    form={form}
                                    setForm={setForm}
                                    actionDefinitions={actionDefinitions ?? []}
                                    saving={saving}
                                    onCancel={cancelForm}
                                    onSubmit={handleAdd}
                                    submitLabel="Add"
                                />
                            )}
                        </div>
                    )}

                    {steps.length === 0 && !isFormOpen && <p className="text-sm text-muted-foreground">No steps yet.</p>}

                    {!isFormOpen && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={startAdd}
                            disabled={actionDefinitions === null || actionDefinitions.length === 0}
                        >
                            <PlusIcon /> Add step
                        </Button>
                    )}

                    {actionDefinitions !== null && actionDefinitions.length === 0 && (
                        <p className="text-sm text-muted-foreground">Create an action definition first to add steps.</p>
                    )}
                </>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
    )
}

function StepFormRow({
    form,
    setForm,
    actionDefinitions,
    saving,
    onCancel,
    onSubmit,
    submitLabel,
}: {
    form: StepForm
    setForm: React.Dispatch<React.SetStateAction<StepForm>>
    actionDefinitions: ActionDefinition[]
    saving: boolean
    onCancel: () => void
    onSubmit: () => void
    submitLabel: string
}) {
    return (
        <div className="flex flex-col gap-2 bg-muted/30 px-3 py-3">
            <div className="flex flex-wrap gap-2">
                <Select
                    value={form.actionId || null}
                    onValueChange={(value) => setForm((f) => ({ ...f, actionId: (value as string) ?? "" }))}
                >
                    <SelectTrigger size="sm" className="min-w-40 flex-1">
                        <SelectValue placeholder="Choose an action" />
                    </SelectTrigger>
                    <SelectContent>
                        {actionDefinitions.map((action) => (
                            <SelectItem key={action.id} value={action.id}>
                                {action.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Input
                    type="number"
                    placeholder="Sequence"
                    value={form.sequence}
                    onChange={(e) => setForm((f) => ({ ...f, sequence: e.target.value }))}
                    className="w-24"
                />
            </div>
            <div className="flex flex-wrap gap-2">
                <Input
                    type="number"
                    placeholder="Lat (optional)"
                    value={form.lat}
                    onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
                    className="w-32"
                />
                <Input
                    type="number"
                    placeholder="Lng (optional)"
                    value={form.lng}
                    onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
                    className="w-32"
                />
            </div>
            <Input
                placeholder="Instruction (optional)"
                value={form.instruction}
                onChange={(e) => setForm((f) => ({ ...f, instruction: e.target.value }))}
            />
            <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
                    Cancel
                </Button>
                <Button type="button" size="sm" onClick={onSubmit} disabled={saving}>
                    {saving ? "Saving…" : submitLabel}
                </Button>
            </div>
        </div>
    )
}
