import { describe, expect, it } from "vitest";
import { parseHourlyPeriods, parseWindMph, toLocalDayHour } from "./nws";
import { checkWindow, DEFAULT_WEATHER_RULE, indexHours, ruleFor, type WeatherHourData } from "./rules";

const hours = (day: string, values: Partial<Record<number, Partial<WeatherHourData>>>, base: Partial<WeatherHourData> = {}) =>
  Array.from({ length: 24 }, (_, hour) => ({ day, hour, tempF: 65, precipChance: 5, windMph: 5, ...base, ...values[hour] }));

describe("NWS parsing", () => {
  it("converts timestamps to local day/hour and parses wind", () => {
    expect(toLocalDayHour("2026-10-20T14:00:00-04:00")).toEqual({ day: "2026-10-20", hour: 14 });
    expect(toLocalDayHour("2026-10-21T02:00:00Z")).toEqual({ day: "2026-10-20", hour: 22 });
    expect(parseWindMph("5 to 15 mph")).toBe(15);
    expect(parseWindMph("10 mph")).toBe(10);
    const [p] = parseHourlyPeriods([
      { startTime: "2026-10-20T08:00:00-04:00", temperature: 48, temperatureUnit: "F", probabilityOfPrecipitation: { value: 30 }, windSpeed: "10 mph", shortForecast: "Cloudy" },
    ]);
    expect(p).toEqual({ day: "2026-10-20", hour: 8, tempF: 48, precipChance: 30, windMph: 10, summary: "Cloudy" });
  });
});

describe("checkWindow", () => {
  const rule = DEFAULT_WEATHER_RULE; // 50°F, 40% rain, 4 dry hours, 25 mph

  it("passes a good day", () => {
    const r = checkWindow(indexHours(hours("2026-10-20", {})), "2026-10-20", 480, 720, rule);
    expect(r).toEqual({ known: true, problems: [] });
  });

  it("flags cold during the work window only", () => {
    const idx = indexHours(hours("2026-10-20", { 7: { tempF: 41 }, 9: { tempF: 47 } }));
    const r = checkWindow(idx, "2026-10-20", 480, 720, rule); // 8 AM–12 PM: the 7 AM reading doesn't count
    expect(r.problems.map((p) => [p.kind, p.value])).toEqual([["COLD", 47]]);
    expect(r.problems[0].message).toBe("47°F at 9:00 AM (limit 50°F)");
  });

  it("flags rain during the dry-time after the work", () => {
    const idx = indexHours(hours("2026-10-20", { 14: { precipChance: 70 } }));
    const r = checkWindow(idx, "2026-10-20", 480, 720, rule); // ends 12 PM; dry until 4 PM
    expect(r.problems[0].kind).toBe("RAIN");
    expect(r.problems[0].message).toContain("within 4 hrs after the work");
    expect(checkWindow(idx, "2026-10-20", 480, 720, { ...rule, dryHoursAfter: 1 }).problems).toEqual([]);
  });

  it("is unknown beyond the forecast", () => {
    expect(checkWindow(indexHours([]), "2026-11-20", 480, 720, rule)).toEqual({ known: false, problems: [] });
  });

  it("lets a job type override the default limits", () => {
    const r = ruleFor({ default: rule, byJobType: { seal: { minTempF: 55, dryHoursAfter: 24 } } }, "seal");
    expect(r).toEqual({ minTempF: 55, maxRainChance: 40, dryHoursAfter: 24, maxWindMph: 25 });
  });
});
