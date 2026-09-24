import "server-only";
import { db } from "./db";

/** True once the owner has switched from sample data to real data. */
export async function isLiveMode() {
  const row = await db.appSetting.findUnique({ where: { key: "mode" } });
  return row?.value === "live";
}
