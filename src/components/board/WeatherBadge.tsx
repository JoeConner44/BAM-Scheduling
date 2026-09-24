import clsx from "clsx";
import type { BoardBlock, BoardWeather } from "./types";

export function weatherIcon(chance: number) {
  return chance >= 60 ? "🌧️" : chance >= 30 ? "🌦️" : chance >= 15 ? "⛅" : "☀️";
}

/** Day-header weather: the worst forecast among the cities that matter that day. */
export function WeatherBadge({ weather, blocks }: { weather: BoardWeather[]; blocks: Pick<BoardBlock, "locationId">[] }) {
  if (!weather.length) return null;
  const working = new Set(blocks.map((b) => b.locationId));
  const relevant = weather.filter((w) => working.has(w.locationId));
  const pool = relevant.length ? relevant : weather;
  const worst = pool.reduce((a, b) => (b.precipChance > a.precipChance ? b : a));
  const risky = relevant.some((w) => w.precipChance >= 50);
  return (
    <span
      className={clsx("chip shrink-0", risky ? "bg-cyan-700 text-white" : "bg-white text-slate-600")}
      title={weather.map((w) => `${w.city}: ${w.precipChance}% rain${w.summary ? ` — ${w.summary}` : ""}`).join("\n")}
    >
      {weatherIcon(worst.precipChance)} {worst.precipChance}%{risky && ` ${worst.city}`}
    </span>
  );
}
