import Link from "next/link";
import { EquipmentForm } from "@/components/EquipmentForm";
import { OFFICE, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function NewEquipmentPage() {
  await requireUser(OFFICE);
  const locations = await db.location.findMany({ orderBy: { city: "asc" } });
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-3 sm:p-6">
      <Link href="/equipment" className="text-sm font-semibold text-blue-700">
        ← Equipment
      </Link>
      <h1 className="text-2xl font-bold">Add equipment</h1>
      <EquipmentForm
        locations={locations}
        values={{ name: "", unitCode: "", type: "STRIPING_TRUCK", status: "AVAILABLE", maintenanceNote: "", locationId: "", color: "#475569", active: true }}
      />
    </main>
  );
}
