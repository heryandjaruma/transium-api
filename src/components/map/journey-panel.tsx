"use client"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { formatDistance, formatDuration } from "@/lib/format"
import { ROUTE_PROFILE_LABELS } from "@/lib/journey"
import type { JourneyAlternatives, JourneyOverview, JourneySegment, RouteProfileKey } from "@/lib/journey"

function SegmentRow({ segment }: { segment: JourneySegment }) {
    if (segment.type === "walk") {
        return (
            <li className="flex gap-3 py-3">
                <span className="mt-0.5 text-lg" aria-hidden>
                    🚶
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Walk to {segment.to.name}</p>
                    <p className="text-xs text-muted-foreground">
                        {formatDistance(segment.distanceMeters)} · {formatDuration(segment.durationSeconds)}
                    </p>
                </div>
            </li>
        )
    }

    if (segment.type === "transfer") {
        return (
            <li className="flex gap-3 py-3">
                <span className="mt-0.5 text-lg" aria-hidden>
                    🔁
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Transfer to {segment.to.name}</p>
                    <p className="text-xs text-muted-foreground">{formatDistance(segment.distanceMeters)} on foot</p>
                </div>
            </li>
        )
    }

    if (segment.type === "mission") {
        return (
            <li className="flex gap-3 py-3">
                <span className="mt-0.5 text-lg" aria-hidden>
                    🎯
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{segment.instructions}</p>
                    <p className="text-xs text-muted-foreground">Mission</p>
                </div>
            </li>
        )
    }

    const intermediateStops = Math.max(segment.stops.length - 2, 0)

    return (
        <li className="flex gap-3 py-3">
            <span
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ backgroundColor: segment.routeColor ?? "#2d4c9c" }}
                aria-hidden
            >
                {segment.routeRef ?? "🚌"}
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                    {segment.routeName ?? "Bus"} to {segment.to.name}
                </p>
                <p className="text-xs text-muted-foreground">
                    Board at {segment.from.name} · {formatDistance(segment.distanceMeters)}
                    {intermediateStops > 0 ? ` · ${intermediateStops} stop${intermediateStops === 1 ? "" : "s"}` : ""}
                </p>
            </div>
        </li>
    )
}

function ProfileSwitch({
    alternatives,
    selectedProfile,
    onSelectProfile,
}: {
    alternatives: JourneyAlternatives
    selectedProfile: RouteProfileKey
    onSelectProfile: (key: RouteProfileKey) => void
}) {
    const keys = Object.keys(ROUTE_PROFILE_LABELS) as RouteProfileKey[]
    const available = keys.filter((key) => alternatives[key])
    // Nothing to switch between (e.g. both profiles landed on the same/only route).
    if (available.length < 2) return null

    return (
        <div className="mt-4 flex gap-2">
            {available.map((key) => (
                <Button
                    key={key}
                    size="sm"
                    variant={key === selectedProfile ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => onSelectProfile(key)}
                >
                    {ROUTE_PROFILE_LABELS[key]}
                </Button>
            ))}
        </div>
    )
}

export function JourneyPanel({
    journey,
    alternatives,
    selectedProfile,
    onSelectProfile,
    status,
    onReset,
}: {
    journey: JourneyOverview | null
    alternatives: JourneyAlternatives | null
    selectedProfile: RouteProfileKey
    onSelectProfile: (key: RouteProfileKey) => void
    status: string
    onReset: () => void
}) {
    return (
        <div className="flex h-full w-96 shrink-0 flex-col border-l bg-background">
            <div className="flex items-center justify-between gap-2 p-4">
                <h2 className="font-heading text-lg font-semibold">Journey</h2>
                <Button size="sm" variant="outline" onClick={onReset}>
                    Clear
                </Button>
            </div>
            <Separator />
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <p className="text-sm text-muted-foreground">{status}</p>

                {alternatives && (
                    <ProfileSwitch
                        alternatives={alternatives}
                        selectedProfile={selectedProfile}
                        onSelectProfile={onSelectProfile}
                    />
                )}

                {journey && (
                    <>
                        <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
                            <div>
                                <p className="text-xs text-muted-foreground">Total distance</p>
                                <p className="font-medium">{formatDistance(journey.summary.distanceMeters)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Walking</p>
                                <p className="font-medium">
                                    {formatDistance(journey.summary.walkingDistanceMeters)} ·{" "}
                                    {formatDuration(journey.summary.walkingDurationSeconds)}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Bus legs</p>
                                <p className="font-medium">{journey.summary.busLegCount}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Transfers</p>
                                <p className="font-medium">{journey.summary.transferCount}</p>
                            </div>
                        </div>

                        <ol className="mt-2 divide-y">
                            {journey.segments.map((segment, i) => (
                                <SegmentRow key={i} segment={segment} />
                            ))}
                        </ol>
                    </>
                )}
            </div>
        </div>
    )
}
