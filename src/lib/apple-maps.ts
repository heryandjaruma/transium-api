import { importPKCS8, SignJWT } from "jose";

const APPLE_MAPS_BASE_URL = "https://maps-api.apple.com";

async function createMapsAuthToken(env: CloudflareEnv) {
  const teamId = env.APPLE_MAPS_TEAM_ID;
  const keyId = env.APPLE_MAPS_KEY_ID;
  const privateKeyPem = env.APPLE_MAPS_PRIVATE_KEY;

  if (!teamId || !keyId || !privateKeyPem) {
    throw new Error("Missing Apple Maps credentials");
  }

  const privateKey = await importPKCS8(
    privateKeyPem.replace(/\\n/g, "\n"),
    "ES256"
  );

  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({
      alg: "ES256",
      kid: keyId,
    })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 60)
    .sign(privateKey);
}

// The self-signed auth token above only authorizes `/v1/token`; it must be
// exchanged for a Maps access token (valid ~30 min) to call the other
// endpoints. Cache it for the lifetime of this Worker instance.
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getMapsAccessToken(env: CloudflareEnv): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }

  const authToken = await createMapsAuthToken(env);
  const res = await fetch(`${APPLE_MAPS_BASE_URL}/v1/token`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  if (!res.ok) {
    throw new Error(`Apple Maps token exchange failed: ${res.status} ${await res.text()}`);
  }

  const { accessToken, expiresInSeconds } = (await res.json()) as {
    accessToken: string;
    expiresInSeconds: number;
  };

  // Refresh a bit early to avoid racing the actual expiry.
  cachedAccessToken = { token: accessToken, expiresAt: Date.now() + (expiresInSeconds - 60) * 1000 };
  return accessToken;
}

export type TransportType = "Automobile" | "Walking" | "Cycling";

interface AppleLocation {
  latitude: number;
  longitude: number;
}

interface AppleStep {
  distanceMeters?: number;
  durationSeconds?: number;
  instructions?: string;
  stepPathIndex?: number;
  transportType?: TransportType;
}

interface AppleRoute {
  distanceMeters?: number;
  durationSeconds?: number;
  hasTolls?: boolean;
  name?: string;
  stepIndexes?: number[];
  transportType?: TransportType;
}

export interface DirectionsResponse {
  routes?: AppleRoute[];
  steps?: AppleStep[];
  stepPaths?: AppleLocation[][];
}

/**
 * Fetches a route between two points from Apple Maps' Directions API
 * (`GET /v1/directions`). Distances/durations are per Apple's estimate;
 * `route.stepIndexes` points into `steps`, and each step's `stepPathIndex`
 * points into `stepPaths` for its polyline.
 */
export async function getDirections(
  env: CloudflareEnv,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  transportType: TransportType = "Automobile"
): Promise<DirectionsResponse> {
  const token = await getMapsAccessToken(env);

  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    transportType,
  });

  const res = await fetch(`${APPLE_MAPS_BASE_URL}/v1/directions?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Apple Maps directions request failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}