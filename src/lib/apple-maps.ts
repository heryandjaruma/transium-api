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

async function mapsFetch<T>(env: CloudflareEnv, path: string): Promise<T> {
  const token = await getMapsAccessToken(env);
  const res = await fetch(`${APPLE_MAPS_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Apple Maps request failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

export type TransportType = "Automobile" | "Walking" | "Cycling";

export type MapsLang = "id-ID" | "en-US";
const DEFAULT_MAPS_LANG: MapsLang = "en-US";

/** Parses a caller-supplied `lang` query value, falling back to the default for anything unrecognized. */
export function parseMapsLang(value: string | null): MapsLang {
  if (value === "en-US" || value === "en") return "en-US";
  if (value === "id-ID" || value === "id") return "id-ID";
  return DEFAULT_MAPS_LANG;
}

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
  transportType: TransportType = "Automobile",
  lang: MapsLang = DEFAULT_MAPS_LANG
): Promise<DirectionsResponse> {
  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    transportType,
    lang,
  });

  return mapsFetch(env, `/v1/directions?${params}`);
}

// --- Search / autocomplete / geocode -------------------------------------------------
//
// Only the fields this codebase actually reads are typed below; Apple's responses carry
// more (e.g. structuredAddress, poiCategory) that we don't currently use.

/** A geographic bias applied to search/geocode requests. */
export interface SearchBias {
  /**
   * "north,east,south,west" — results outside this region are deprioritized, not
   * excluded. Apple's API rejects a request that sets both this and a location bias, so
   * this is the only bias knob exposed.
   */
  searchRegion: string;
}

export interface ApplePlaceResult {
  name?: string;
  formattedAddressLines?: string[];
  coordinate?: { latitude: number; longitude: number };
}

export interface AppleSearchResponse {
  results?: ApplePlaceResult[];
}

export interface AppleAutocompleteResult {
  /**
   * Relative path (e.g. "/v1/search?q=...&metadata=...") to resolve this completion
   * into full place details via /v1/search. Present when `location` isn't — mainly for
   * generic query refinements that don't resolve to one specific place yet.
   */
  completionUrl?: string;
  /** Display text for the completion, e.g. `["Eiffel Tower", "Paris, France"]`. */
  displayLines?: string[];
  location?: { latitude: number; longitude: number };
}

export interface AppleAutocompleteResponse {
  results?: AppleAutocompleteResult[];
}

function searchParams(query: string, bias: SearchBias): URLSearchParams {
  return new URLSearchParams({
    q: query,
    searchRegion: bias.searchRegion,
    limitToCountries: "ID",
  });
}

/** Search-as-you-type completions via Apple's `/v1/searchAutocomplete`. */
export async function searchAutocomplete(
  env: CloudflareEnv,
  query: string,
  bias: SearchBias
): Promise<AppleAutocompleteResponse> {
  return mapsFetch(env, `/v1/searchAutocomplete?${searchParams(query, bias)}`);
}

/**
 * Resolves a searchAutocomplete result's `completionUrl` into full place details. The
 * URL is Apple's own relative path (already includes `q` and an opaque `metadata`
 * token) — pass it through unchanged.
 */
export async function resolveCompletion(env: CloudflareEnv, completionUrl: string): Promise<AppleSearchResponse> {
  return mapsFetch(env, completionUrl);
}

/** Resolves a free-text address/place to coordinates via Apple's `/v1/geocode`. */
export async function geocode(env: CloudflareEnv, query: string, bias: SearchBias): Promise<AppleSearchResponse> {
  return mapsFetch(env, `/v1/geocode?${searchParams(query, bias)}`);
}

/** Resolves coordinates to an address via Apple's `/v1/reverseGeocode`. */
export async function reverseGeocode(
  env: CloudflareEnv,
  location: { lat: number; lng: number },
  lang: MapsLang = DEFAULT_MAPS_LANG
): Promise<AppleSearchResponse> {
  const params = new URLSearchParams({
    loc: `${location.lat},${location.lng}`,
    lang,
  });

  return mapsFetch(env, `/v1/reverseGeocode?${params}`);
}
