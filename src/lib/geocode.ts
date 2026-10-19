import "server-only";

// Free address → GPS lookup from the US Census Bureau (no key). Used to place jobs on the
// map for travel times and to know where to get the weather forecast.

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const data = await res.json();
    const match = data?.result?.addressMatches?.[0]?.coordinates;
    if (typeof match?.x !== "number" || typeof match?.y !== "number") return null;
    return { lat: match.y, lng: match.x };
  } catch {
    return null; // lookup is best effort; the app works without coordinates
  }
}
