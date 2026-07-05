export const SITE_ORIGIN = "https://tesla-map-bridge.vercel.app";

export const APP_DISPLAY_NAME = "CarMap Link";

export const IOS_APP_STORE_WEB =
  "https://apps.apple.com/app/carmap-link/id6755061619";

export const PLAY_STORE_WEB =
  "https://play.google.com/store/apps/details?id=com.smartcompany.teslaMapBridge";

export const IOS_APP_STORE_ITMS =
  "itms-apps://apps.apple.com/app/carmap-link/id6755061619";

export const PLAY_STORE_MARKET =
  "market://details?id=com.smartcompany.teslaMapBridge";

type Platform = "ios" | "android" | "other";

export function detectPlatformFromUa(userAgent: string): Platform {
  const ua = userAgent.toLowerCase();
  if (ua.includes("android")) {
    return "android";
  }
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) {
    return "ios";
  }
  return "other";
}

export function pickStoreUrl(userAgent: string): string {
  return detectPlatformFromUa(userAgent) === "android"
    ? PLAY_STORE_WEB
    : IOS_APP_STORE_WEB;
}
