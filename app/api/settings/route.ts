import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.TeslaClientId;
  const clientSecret = process.env.TeslaClientSecret;
  const purchaseMode = "creditPack";

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Tesla credentials are not configured." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      clientId,
      clientSecret,
      purchaseMode,
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

export function OPTIONS() {
  return NextResponse.json(
    {},
    {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    },
  );
}

