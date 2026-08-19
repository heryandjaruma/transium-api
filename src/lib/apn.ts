import { importPKCS8, SignJWT } from "jose"

// Apple runs two entirely separate push services; a device token minted by a
// debug/Xcode build only works against sandbox, and a TestFlight/App Store
// build only works against production (see DeviceToken.environment).
const APNS_HOST: Record<string, string> = {
    production: "https://api.push.apple.com",
    sandbox: "https://api.sandbox.push.apple.com",
}

export type PushPayload = {
    title: string
    body: string
    sound?: string
    badge?: number
    /** Extra top-level fields merged into the payload, outside `aps`. */
    data?: Record<string, unknown>
}

export type PushResult = {
    token: string
    ok: boolean
    status: number
    reason?: string
}

export function isApnsConfigured(env: CloudflareEnv): boolean {
    return Boolean(env.APNS_TEAM_ID && env.APNS_KEY_ID && env.APNS_PRIVATE_KEY && env.APNS_TOPIC)
}

// Apple's provider tokens are valid up to 1 hour; regenerate a bit early and
// reuse across requests/devices rather than signing one per push, since
// Apple rate-limits how often a given key may mint a fresh token.
const TOKEN_TTL_SECONDS = 55 * 60

let cachedToken: { jwt: string; expiresAt: number; keyId: string } | null = null

async function getProviderToken(env: CloudflareEnv): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    if (cachedToken && cachedToken.keyId === env.APNS_KEY_ID && cachedToken.expiresAt > now) {
        return cachedToken.jwt
    }

    const key = await importPKCS8(env.APNS_PRIVATE_KEY.replace(/\\n/g, "\n"), "ES256")
    const jwt = await new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid: env.APNS_KEY_ID })
        .setIssuer(env.APNS_TEAM_ID)
        .setIssuedAt(now)
        .sign(key)

    cachedToken = { jwt, expiresAt: now + TOKEN_TTL_SECONDS, keyId: env.APNS_KEY_ID }
    return jwt
}

async function sendToDevice(
    env: CloudflareEnv,
    jwt: string,
    device: { token: string; environment: string },
    payload: PushPayload
): Promise<PushResult> {
    const host = APNS_HOST[device.environment] ?? APNS_HOST.production

    const response = await fetch(`${host}/3/device/${device.token}`, {
        method: "POST",
        headers: {
            authorization: `bearer ${jwt}`,
            "apns-topic": env.APNS_TOPIC,
            "apns-push-type": "alert",
            "apns-priority": "10",
        },
        body: JSON.stringify({
            aps: {
                alert: { title: payload.title, body: payload.body },
                sound: payload.sound ?? "default",
                ...(payload.badge !== undefined ? { badge: payload.badge } : {}),
            },
            ...payload.data,
        }),
    })

    if (response.ok) return { token: device.token, ok: true, status: response.status }

    const errorBody = (await response.json().catch(() => null)) as { reason?: string } | null
    return { token: device.token, ok: false, status: response.status, reason: errorBody?.reason }
}

// Apple reports a token as permanently dead this way, either as a 410 on
// send or (independent of any push) via BadDeviceToken/Unregistered reasons.
function isStaleToken(result: PushResult): boolean {
    return result.status === 410 || result.reason === "BadDeviceToken" || result.reason === "Unregistered"
}

/**
 * Pushes a notification to every device registered for a user, across every
 * device they're signed in on. Devices Apple reports as no-longer-valid are
 * removed from DeviceToken so they aren't retried on the next send.
 *
 * Throws if APNs isn't configured (see isApnsConfigured) — check that first
 * if the caller should degrade gracefully instead.
 */
export async function sendPushToUser(env: CloudflareEnv, userId: string, payload: PushPayload): Promise<PushResult[]> {
    if (!isApnsConfigured(env)) {
        throw new Error("APNs is not configured (APNS_TEAM_ID/APNS_KEY_ID/APNS_PRIVATE_KEY/APNS_TOPIC)")
    }

    const { results: devices } = await env.DB.prepare(`SELECT token, environment FROM DeviceToken WHERE userId = ?`)
        .bind(userId)
        .all<{ token: string; environment: string }>()
    if (devices.length === 0) return []

    const jwt = await getProviderToken(env)
    const outcomes = await Promise.all(devices.map((device) => sendToDevice(env, jwt, device, payload)))

    const staleTokens = outcomes.filter(isStaleToken).map((result) => result.token)
    if (staleTokens.length > 0) {
        await env.DB.prepare(`DELETE FROM DeviceToken WHERE token IN (${staleTokens.map(() => "?").join(",")})`)
            .bind(...staleTokens)
            .run()
    }

    return outcomes
}
