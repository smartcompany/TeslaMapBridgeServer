import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

async function assertUserMatchesToken(accessToken: string, userId: string) {
  if (!accessToken) {
    throw new UnauthorizedError("Missing Authorization token");
  }

  try {
    const response = await fetch(TESLA_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new UnauthorizedError("Invalid Tesla access token");
    }

    const profile = (await response.json()) as Record<string, unknown>;

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

export async function POST(request: Request) {
  const { userId } = await request.json() as { userId?: string };
  if (!userId || userId.length === 0) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const {data: existing, error: existingError} = await supabase
      .from(TABLE_NAME)
      .select("user_id, quota")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingError || !existing) {
      throw new Error(existingError?.message ?? "Failed to load quota");
    }

    if (existing.quota <= 0) {
      return NextResponse.json({
        userId: existing.user_id,
        quota: existing.quota,
      });
    }

    const accessToken = extractBearerToken(request.headers.get("authorization"));
    if (!accessToken) {
      return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
    }

    await assertUserMatchesToken(accessToken, userId);

    const newQuota = existing.quota - 1;
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .update({ quota: newQuota })
      .eq("user_id", existing.user_id)
      .select("user_id,quota")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to update quota");
    }

    return NextResponse.json({
      userId: data.user_id,
      quota: data.quota,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    console.error("[Quota] POST failed", error);
    return NextResponse.json({ error: "Failed to update quota" }, { status: 500 });
  }
}
