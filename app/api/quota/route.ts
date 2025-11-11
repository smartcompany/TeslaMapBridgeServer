import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_QUOTA = 10;
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

async function ensureUserRow(userId: string) {
  const { data: existing, error } = await supabase
    .from(TABLE_NAME)
    .select("user_id,quota")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (existing) {
    return existing;
  }

  const { data: inserted, error: insertError } = await supabase
    .from(TABLE_NAME)
    .insert({ user_id: userId, quota: DEFAULT_QUOTA })
    .select("user_id,quota")
    .single();

  if (insertError || !inserted) {
    throw new Error(insertError?.message ?? "Failed to create quota row");
  }

  return inserted;
}

async function resolveUserIdFromToken(request: Request): Promise<string> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    throw new UnauthorizedError("Missing Authorization header");
  }

  const [scheme, token] = authHeader.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    throw new UnauthorizedError("Invalid Authorization header");
  }

  let profile: Record<string, unknown>;
  try {
    const response = await fetch(TESLA_USERINFO_URL, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new UnauthorizedError("Invalid Tesla access token");
    }

    profile = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    console.error("[Quota] Tesla token verification failed", error);
    throw new UnauthorizedError("Failed to verify Tesla token");
  }

  const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : undefined;
  const sub = typeof profile.sub === "string" ? profile.sub.trim() : undefined;
  const userId = email || sub;

  if (!userId) {
    throw new UnauthorizedError("Unable to resolve user identity");
  }

  return userId;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json(
      { error: "userId query parameter is required" },
      { status: 400 },
    );
  }

  try {
    const row = await ensureUserRow(userId);

    return NextResponse.json({
      userId: row.user_id,
      quota: row.quota,
    });
  } catch (error) {
    console.error("[Quota] GET failed", error);
    return NextResponse.json({ error: "Failed to load quota" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { userId, useQuota } = payload as { userId?: string; useQuota?: boolean };

  if (!userId || userId.trim().length === 0) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  if (useQuota == null || typeof useQuota !== "boolean") {
    return NextResponse.json({ error: "useQuota must be a boolean" }, { status: 400 });
  }

  try {
    await resolveUserIdFromToken(request);

    const row = await ensureUserRow(userId);
    if (row.quota <= 0) {
      return NextResponse.json({
        userId: row.user_id,
        quota: row.quota,
        error: "Quota exhausted",
      }, { status: 409 });
    }

    const newQuota = row.quota - 1;
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .update({ quota: newQuota })
      .eq("user_id", userId)
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
