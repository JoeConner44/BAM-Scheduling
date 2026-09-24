import { TodoBoard } from "@/components/TodoBoard";
import { OFFICE, requireUser } from "@/lib/auth";
import { openProjects, toCard } from "@/lib/data";
import { today } from "@/lib/time";

export const metadata = { title: "TO DO · BAM Scheduling" };

export default async function TodoPage({ searchParams }: PageProps<"/todo">) {
  await requireUser(OFFICE);
  const sp = await searchParams;
  const cards = (await openProjects()).map(toCard);
  return (
    <TodoBoard
      cards={cards}
      today={today()}
      initial={{ status: typeof sp.status === "string" ? sp.status : "", needs: sp.needs === "1" }}
    />
  );
}
