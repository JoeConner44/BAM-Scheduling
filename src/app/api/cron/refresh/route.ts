import { replan } from "@/lib/planner/run";
import { refreshWeatherAndReplan } from "@/lib/weather/refresh";

// Called by Vercel Cron (see vercel.json). Pulls fresh forecasts and re-plans the schedule.
// When CRON_SECRET is set, Vercel sends it as a bearer token and other callers are refused.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const weather = await refreshWeatherAndReplan({ force: true });
  // Re-plan daily even without new weather: the frozen window moves forward each day.
  if (weather.updated === 0) await replan("daily check");
  return Response.json({ ok: true, weather });
}
