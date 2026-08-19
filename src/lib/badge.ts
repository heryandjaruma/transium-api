export type Badge = {
    id: string
    name: string
    category: string
    description: string
    type: string
    imageUrl: string | null
    kelurahanId: string | null
}

/** A badge the caller has earned (a UserBadge row joined with its Badge and, if earned via a journey, that quest). */
export type EarnedBadge = {
    id: string
    badgeId: string
    badgeName: string
    badgeCategory: string
    badgeType: string
    badgeImageUrl: string | null
    earnedAt: string
    questId: string | null
    questName: string | null
}
