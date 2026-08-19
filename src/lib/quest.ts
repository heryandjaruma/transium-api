export type QuestMedia = {
    id: string
    createdAt: string
    type: string
    url: string
}

export type Quest = {
    id: string
    name: string
    category: string
    description: string
    xp: number
    label: string | null
    thumbnails: QuestMedia[]
}
