import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.TeslaClientId;
  const clientSecret = process.env.TeslaClientSecret;
  const purchaseMode = "creditPack";
  const creditPacks = [
    { productId: "com.smartcompany.teslaMapBridge.credit100", credits: 100 },
    { productId: "com.smartcompany.teslaMapBridge.credit400", credits: 400 },
    { productId: "com.smartcompany.teslaMapBridge.credit800", credits: 800 },
    { productId: "com.smartcompany.teslaMapBridge.credit1000", credits: 1000 },
  ];

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
      creditPacks,
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

