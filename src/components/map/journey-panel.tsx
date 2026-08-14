"use client"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { formatDistance, formatDuration } from "@/lib/format"
import type { JourneyOverview, JourneySegment } from "@/lib/journey"

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

export function JourneyPanel({
    journey,
    status,
    onReset,
}: {
    journey: JourneyOverview | null
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
