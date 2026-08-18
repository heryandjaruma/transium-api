export type BadgeActionStep = {
    id: string
    badgeId: string
    actionId: string
    actionName: string
    actionType: string
    sequence: number
    lat: number | null
    lng: number | null
    instruction: string | null
}
