import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_QUOTA = 20;
const TABLE_NAME = "tesla_map_bridge_usage_quota";
const TESLA_USERINFO_URL = "https://auth.tesla.com/oauth2/v3/userinfo";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_KEY;

if (!supabaseUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
}

if (!supabaseKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_KEY is not configured");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

async function ensureUserRow({
  userId,
  accessToken,
}: {
  userId: string;
  accessToken?: string;
}) {
  console.log(`[Quota] ensureUserRow called for userId: ${userId}`);
  const { data: existing, error } = await supabase
    .from(TABLE_NAME)
    .select("user_id,quota")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[Quota] Supabase select error:", error);
    throw new Error(error.message);
  }

  if (existing) {
    console.log(`[Quota] Found existing user row for ${userId}`);
    return existing;
  }

  console.log(`[Quota] User row not found for ${userId}, creating new row...`);

  if (!accessToken) {
    throw new UnauthorizedError("Missing Authorization token for new user");
  }

  await assertUserMatchesToken(accessToken, userId);

  const { data: inserted, error: insertError } = await supabase
    .from(TABLE_NAME)
    .insert({ user_id: userId, quota: DEFAULT_QUOTA })
    .select("user_id,quota")
    .single();

  if (insertError || !inserted) {
    console.error("[Quota] Supabase insert error:", insertError);
    throw new Error(insertError?.message ?? "Failed to create quota row");
  }

  console.log(`[Quota] Created new user row for ${userId}`);
  return inserted;
}

async function assertUserMatchesToken(accessToken: string, userId: string) {
  console.log(`[Quota] Verifying token for ${userId}`);
  if (!accessToken) {
    throw new UnauthorizedError("Missing Authorization token");
  }

  try {
    const response = await fetch(TESLA_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(`[Quota] Tesla UserInfo failed: ${response.status} ${response.statusText}`);
      throw new UnauthorizedError("Invalid Tesla access token");
    }

    const profile = (await response.json()) as Record<string, unknown>;
    // ... rest of validation logic


    if (!profile.email || typeof profile.email !== "string") {
      console.error("[Quota] Tesla profile missing email", {
        userId,
        keys: Object.keys(profile),
        aud: profile.aud,
        scopes: profile.scope,
      });
    }

    const email = typeof profile.email === "string" ? profile.email.toLowerCase() : undefined;
    if (!email) {
      throw new UnauthorizedError("Tesla user profile missing email");
    }

    if (email !== userId.toLowerCase()) {
      throw new UnauthorizedError("Tesla access token does not match requested userId");
    }
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    console.error("[Quota] Tesla token verification failed", error);
    throw new UnauthorizedError("Failed to verify Tesla token");
  }
}

function extractBearerToken(headerValue: string | null) {
  if (!headerValue) {
    return null;
  }
  const [scheme, token] = headerValue.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token.trim();
}

export async function GET(request: Request) {
  const accessToken = extractBearerToken(request.headers.get("authorization"));
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  console.log(`[Quota] GET request received. userId: ${userId}, hasToken: ${!!accessToken}`);

  if (!accessToken) {
    return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
  }

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const row = await ensureUserRow({ userId, accessToken: accessToken });

    return NextResponse.json({
      userId: row.user_id,
      quota: row.quota,
    });
  } catch (error) {
    console.error("[Quota] GET handler caught error:", error);
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load quota" }, { status: 500 });
  }
}
