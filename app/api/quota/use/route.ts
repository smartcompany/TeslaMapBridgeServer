import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  UnauthorizedError,
  assertUserMatchesToken,
  extractBearerToken,
} from "../../../lib/teslaAuth";

const TABLE_NAME = "tesla_map_bridge_usage_quota";

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

export async function POST(request: Request) {
  try {
    const accessToken = extractBearerToken(request.headers.get("authorization"));
    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing Authorization header" },
        { status: 401 },
      );
    }

    const body = (await request.json()) as { userId?: string };
    const userId = body.userId?.trim().toLowerCase();
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    await assertUserMatchesToken(accessToken, userId);

    const { data: existing, error: existingError } = await supabase
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

    console.error("[Quota] POST /use failed", error);
    return NextResponse.json({ error: "Failed to update quota" }, { status: 500 });
  }
}
