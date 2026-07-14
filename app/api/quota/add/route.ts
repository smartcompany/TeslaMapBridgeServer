import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TABLE_NAME = "tesla_map_bridge_usage_quota";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { userId?: string; credits?: number };
    const userId = body.userId?.trim().toLowerCase();
    const credits = Number.isFinite(body.credits)
      ? Math.max(0, Math.floor(body.credits!))
      : 0;
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }
    if (credits <= 0) {
      return NextResponse.json({ error: "credits must be > 0" }, { status: 400 });
    }

    const { data: existing, error: existingError } = await supabase
      .from(TABLE_NAME)
      .select("user_id, quota")
      .eq("user_id", userId)
      .maybeSingle();
    if (existingError) {
      throw new Error(existingError.message);
    }

    if (!existing) {
      const { data: inserted, error: insertError } = await supabase
        .from(TABLE_NAME)
        .insert({ user_id: userId, quota: credits })
        .select("user_id, quota")
        .single();
      if (insertError || !inserted) {
        throw new Error(insertError?.message ?? "Failed to create quota");
      }
      return NextResponse.json({
        userId: inserted.user_id,
        quota: inserted.quota,
      });
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
    console.error("[Quota] /add failed", error);
    return NextResponse.json({ error: "Failed to add quota" }, { status: 500 });
  }
}
