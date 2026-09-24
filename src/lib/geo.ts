// Distance and travel-time estimates. For the MVP we use straight-line distance with a
// road factor and an average speed. A real routing service can replace `estimateTravelMinutes`.

export interface LatLng {
  lat: number;
  lng: number;
}

export const TRAVEL_SETTINGS = {
  averageMph: 40,
  roadFactor: 1.3,
  /** Minimum time to pack up and move even between neighboring sites. */
  minimumMinutes: 10,
};

export function milesBetween(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function estimateTravelMinutes(a: LatLng, b: LatLng, settings = TRAVEL_SETTINGS): number {
  const roadMiles = milesBetween(a, b) * settings.roadFactor;
  if (roadMiles < 0.25) return 0; // same site
  const minutes = (roadMiles / settings.averageMph) * 60;
  return Math.max(settings.minimumMinutes, Math.round(minutes / 5) * 5);
}

export function hasCoords(p: { lat: number | null; lng: number | null }): p is LatLng {
  return typeof p.lat === "number" && typeof p.lng === "number";
}
