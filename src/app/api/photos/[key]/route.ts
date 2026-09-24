import { currentUser } from "@/lib/auth";
import { readPhoto } from "@/lib/storage";

export async function GET(_req: Request, ctx: RouteContext<"/api/photos/[key]">) {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const { key } = await ctx.params;
  const photo = await readPhoto(key);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.body), { headers: { "Content-Type": photo.type, "Cache-Control": "private, max-age=86400" } });
}
