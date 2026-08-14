export function formatDistance(meters: number | null | undefined) {
    if (meters == null) return "—"
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

export function formatDuration(seconds: number | null | undefined) {
    if (seconds == null) return "—"
    const minutes = Math.round(seconds / 60)
    if (minutes < 1) return "<1 min"
    if (minutes < 60) return `${minutes} min`
    const hours = Math.floor(minutes / 60)
    const remainder = minutes % 60
    return remainder ? `${hours} h ${remainder} min` : `${hours} h`
}
