import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TABLE_NAME = "tesla_map_bridge_usage_quota";
const DEFAULT_QUOTA = 20;

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

async function ensureUserRow(userId: string) {
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId")?.trim().toLowerCase() ?? null;

  console.log(`[Quota] GET request received. userId: ${userId}`);

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const row = await ensureUserRow(userId);

    return NextResponse.json({
      userId: row.user_id,
      quota: row.quota,
    });
  } catch (error) {
    console.error("[Quota] GET handler caught error:", error);
    return NextResponse.json({ error: "Failed to load quota" }, { status: 500 });
  }
}
