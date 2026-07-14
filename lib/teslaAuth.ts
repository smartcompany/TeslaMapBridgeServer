/** Shared Tesla access-token identity checks for quota APIs. */

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

const TESLA_USERINFO_URL = "https://auth.tesla.com/oauth2/v3/userinfo";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function emailFromUnknown(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return undefined;
  return trimmed;
}

function isFleetUrl(url: string): boolean {
  try {
    const host = new URL(url).host;
    return host.includes("fleet-api.prd.");
  } catch {
    return false;
  }
}

function pickFleetBaseUrl(aud: unknown): string | null {
  const candidates: string[] = [];
  if (typeof aud === "string" && isFleetUrl(aud)) candidates.push(aud);
  if (Array.isArray(aud)) {
    for (const value of aud) {
      if (typeof value === "string" && isFleetUrl(value)) candidates.push(value);
    }
  }
  if (candidates.length === 0) return null;
  const order = ["na", "apac", "cn", "eu"];
  for (const region of order) {
    const match = candidates.find((u) => u.includes(`.prd.${region}.`));
    if (match) return match.replace(/\/$/, "");
  }
  return candidates[0].replace(/\/$/, "");
}

async function emailFromFleetUsersMe(
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const base = pickFleetBaseUrl(payload.aud);
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/1/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[Quota] Fleet users/me failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      response?: { email?: string };
    };
    return emailFromUnknown(data.response?.email) ?? null;
  } catch (error) {
    console.warn("[Quota] Fleet users/me error", error);
    return null;
  }
}

/**
 * Resolve the account email for a Tesla user access token.
 * userinfo often omits email for Fleet tokens; JWT / Fleet users/me are fallbacks.
 */
export async function resolveTokenEmail(
  accessToken: string,
): Promise<string | null> {
  try {
    const response = await fetch(TESLA_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (response.ok) {
      const profile = (await response.json()) as Record<string, unknown>;
      const fromProfile =
        emailFromUnknown(profile.email) ??
        emailFromUnknown(profile.preferred_username) ??
        emailFromUnknown(profile.sub);
      if (fromProfile) return fromProfile;

      console.warn("[Quota] Tesla userinfo OK but no email claim", {
        keys: Object.keys(profile),
        aud: profile.aud,
        scope: profile.scope,
        sub: profile.sub,
      });
    } else {
      console.warn(
        `[Quota] Tesla userinfo failed: ${response.status} ${response.statusText}`,
      );
    }
  } catch (error) {
    console.warn("[Quota] Tesla userinfo request error", error);
  }

  const payload = decodeJwtPayload(accessToken);
  if (!payload) return null;

  const fromJwt =
    emailFromUnknown(payload.email) ??
    emailFromUnknown(payload.preferred_username) ??
    emailFromUnknown(payload.sub);
  if (fromJwt) return fromJwt;

  const fromFleet = await emailFromFleetUsersMe(accessToken, payload);
  if (fromFleet) return fromFleet;

  console.error("[Quota] No email in userinfo, JWT, or Fleet users/me", {
    keys: Object.keys(payload),
    aud: payload.aud,
    scp: payload.scp ?? payload.scope,
    sub: payload.sub,
  });
  return null;
}

export async function assertUserMatchesToken(
  accessToken: string,
  userId: string,
): Promise<void> {
  if (!accessToken) {
    throw new UnauthorizedError("Missing Authorization token");
  }

  const email = await resolveTokenEmail(accessToken);
  if (!email) {
    throw new UnauthorizedError("Tesla user profile missing email");
  }

  if (email !== userId.trim().toLowerCase()) {
    throw new UnauthorizedError(
      "Tesla access token does not match requested userId",
    );
  }
}

export function extractBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}
