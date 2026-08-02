import { ipcMain } from "electron";

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
  city?: string;
  country?: string;
}

// IP-based geolocation instead of the browser's native navigator.geolocation — Chromium's
// Geolocation API needs OS-level Location Services permission, which an unsigned/dev
// Electron build frequently can't obtain at all (no Info.plist usage description, not a
// recognized bundle to macOS CoreLocation), so getCurrentPosition would hang or error with
// no OS prompt ever appearing. ipwho.is is free, keyless, HTTPS, and returns city/country
// directly, so the app just needs an outbound network request — no permission, no prompt.
const IP_GEOLOCATION_URL = "https://ipwho.is/";

// IP geolocation is inherently city-level, not GPS-precise — this is a fixed placeholder
// "accuracy in meters" so LocationData's shape stays meaningful to callers without
// pretending to a precision the source doesn't have.
const IP_GEOLOCATION_ACCURACY_METERS = 50_000;

let lastLocation: LocationData | null = null;

interface IpWhoIsResponse {
  success?: boolean;
  latitude?: number;
  longitude?: number;
  city?: string;
  country?: string;
}

async function fetchIpLocation(): Promise<LocationData | null> {
  try {
    const res = await fetch(IP_GEOLOCATION_URL);
    if (!res.ok) return null;
    const data = (await res.json()) as IpWhoIsResponse;
    if (data.success === false || typeof data.latitude !== "number" || typeof data.longitude !== "number") {
      return null;
    }
    return {
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: IP_GEOLOCATION_ACCURACY_METERS,
      capturedAt: new Date().toISOString(),
      city: data.city,
      country: data.country,
    };
  } catch {
    return null;
  }
}

export function registerLocationHandlers() {
  // Renderer-triggered one-shot refresh (see useLocation.ts) — fetches and caches the
  // current IP-based location. Returns null (rather than throwing) on failure so a flaky
  // lookup doesn't surface as an error to the user for a best-effort background feature.
  ipcMain.handle("location:refresh", async (): Promise<LocationData | null> => {
    const location = await fetchIpLocation();
    if (location) lastLocation = location;
    return lastLocation;
  });

  ipcMain.handle("location:get", (): LocationData | null => lastLocation);
}

export function getCurrentLocation(): LocationData | null {
  return lastLocation;
}
