import { getCloudflareContext } from "@opennextjs/cloudflare"
import { betterAuth } from "better-auth"
import { bearer } from "better-auth/plugins"
import { importPKCS8, SignJWT } from "jose"

// Apple requires a JWT client secret for web OAuth.
// We generate it from the Apple .p8 private key when needed.
async function generateAppleClientSecret(clientId: string, teamId: string, keyId: string, privateKey: string) {
    const key = await importPKCS8(privateKey, "ES256")
    const now = Math.floor(Date.now() / 1000)

    return new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid: keyId })
        .setIssuer(teamId)
        .setSubject(clientId)
        .setAudience("https://appleid.apple.com")
        .setIssuedAt(now)
        .setExpirationTime(now + 60 * 24 * 60 * 60)
        .sign(key)
}

// Configure Sign in with Apple.
//
// iOS only needs the app bundle identifier because Apple already
// gives the app an identity token.
//
// The Service ID and .p8 credentials are only needed if we later
// support Apple's web OAuth flow.
function buildAppleProvider(env: CloudflareEnv) {
    const bundleId = env.APPLE_APP_BUNDLE_IDENTIFIER
    if (!bundleId) return undefined

    const serviceId = env.APPLE_CLIENT_ID
    const canSignClientSecret = serviceId && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY

    return {
        apple: async () => ({
            clientId: serviceId ? [bundleId, serviceId] : bundleId,
            appBundleIdentifier: bundleId,
            ...(canSignClientSecret
                ? {
                      clientSecret: await generateAppleClientSecret(
                          serviceId,
                          env.APPLE_TEAM_ID,
                          env.APPLE_KEY_ID,
                          env.APPLE_PRIVATE_KEY.replace(/\\n/g, "\n")
                      ),
                  }
                : {}),
        }),
    }
}

export function buildAuth(env: CloudflareEnv) {
    return betterAuth({
        // Better Auth can use the Cloudflare D1 binding directly.
        database: env.DB,
        secret: env.BETTER_AUTH_SECRET,
        baseURL: env.BETTER_AUTH_URL || undefined,
        // Origins allowed to call the auth endpoints.
        trustedOrigins: (env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(",").filter(Boolean),
        socialProviders: buildAppleProvider(env),
        plugins: [
            // Let the iOS app authenticate API requests using:
            // Authorization: Bearer <session-token>
            bearer(),
        ],
    })
}

// Reuse one Better Auth instance for the current Worker runtime.
let cached: ReturnType<typeof buildAuth> | null = null

export function getAuth() {
    if (!cached) {
        const { env } = getCloudflareContext()
        cached = buildAuth(env)
    }
    return cached
}
