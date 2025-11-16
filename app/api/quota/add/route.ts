import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TABLE_NAME = "tesla_map_bridge_usage_quota";
const TESLA_USERINFO_URL = "https://auth.tesla.com/oauth2/v3/userinfo";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

class UnauthorizedError extends Error {}

function extractBearerToken(headerValue: string | null) {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

async function assertUserMatchesToken(accessToken: string, userId: string) {
  const res = await fetch(TESLA_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new UnauthorizedError("Invalid Tesla access token");
  const profile = (await res.json()) as Record<string, unknown>;
  const email = typeof profile.email === "string" ? profile.email.toLowerCase() : undefined;
  if (!email || email !== userId.toLowerCase()) {
    throw new UnauthorizedError("Tesla access token does not match requested userId");
  }
}

export async function POST(request: Request) {
  try {
    const accessToken = extractBearerToken(request.headers.get("authorization"));
    if (!accessToken) {
      return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
    }
    const body = (await request.json()) as { userId?: string; credits?: number };
    const userId = body.userId?.trim();
    const credits = Number.isFinite(body.credits) ? Math.max(0, Math.floor(body.credits!)) : 0;
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }
    if (credits <= 0) {
      return NextResponse.json({ error: "credits must be > 0" }, { status: 400 });
    }
    await assertUserMatchesToken(accessToken, userId);

    const { data: existing, error: existingError } = await supabase
      .from(TABLE_NAME)
      .select("user_id, quota")
      .eq("user_id", userId)
      .maybeSingle();
    if (existingError || !existing) {
      return NextResponse.json({ error: "Quota record not found" }, { status: 404 });
    }

    const newQuota = (existing.quota as number) + credits;
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .update({ quota: newQuota })
      .eq("user_id", userId)
      .select("user_id, quota")
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? "Failed to add quota");
    }
    return NextResponse.json({ userId: data.user_id, quota: data.quota });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("[Quota] /add failed", error);
    return NextResponse.json({ error: "Failed to add quota" }, { status: 500 });
  }
}


