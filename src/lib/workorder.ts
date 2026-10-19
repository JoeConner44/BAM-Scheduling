import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { EQUIPMENT_TYPE_LABEL } from "./labels";

// Reads an uploaded work order (PDF or photo) with Claude and returns the job details as
// structured fields. The estimator always reviews them before the job is created.

const EQUIPMENT_TYPES = Object.keys(EQUIPMENT_TYPE_LABEL) as [string, ...string[]];

export const WorkOrderSchema = z.object({
  workOrderNumber: z.string().nullable().describe("Work order / PO / job number printed on the document"),
  customer: z.string().nullable().describe("Company or property owner the work is for"),
  jobName: z.string().nullable().describe("Short job name, usually the business or property name (e.g. 'Kroger', 'Maple Creek Middle School')"),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  street: z.string().nullable().describe("Job site street address (not the billing address)"),
  city: z.string().nullable(),
  state: z.string().nullable().describe("Two-letter state"),
  zip: z.string().nullable(),
  jobType: z.string().nullable().describe("Best match from the provided job types, or a short new name"),
  scope: z.string().nullable().describe("One or two sentences describing the work"),
  materials: z
    .array(z.object({ name: z.string(), quantity: z.number().nullable(), unit: z.string().nullable() }))
    .describe("Every material line: paint by color, glass beads, thermoplastic, sealer, primer, etc."),
  estimatedHours: z.number().nullable().describe("Total labor hours if stated or clearly derivable; otherwise null"),
  crewSize: z.number().nullable().describe("Number of workers if stated; otherwise null"),
  equipmentNeeded: z.array(z.enum(EQUIPMENT_TYPES)).describe("Equipment types the work clearly requires"),
  deadline: z.string().nullable().describe("Must-finish-by date as YYYY-MM-DD if stated"),
  requestedDate: z.string().nullable().describe("Customer's requested or scheduled date as YYYY-MM-DD if stated"),
  notes: z.string().nullable().describe("Site notes: access, hours, after-hours/night work, lot closures"),
});

export type WorkOrderFields = z.infer<typeof WorkOrderSchema>;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

export const workOrderReadingEnabled = () => !!process.env.ANTHROPIC_API_KEY;

export function workOrderFileError(file: File): string | null {
  if (file.type !== "application/pdf" && !IMAGE_TYPES.includes(file.type as ImageType)) {
    return "Upload the work order as a PDF or a photo (JPG or PNG). iPhone HEIC photos: share as JPG.";
  }
  if (file.size > 20 * 1024 * 1024) return "That file is too large (20 MB max).";
  return null;
}

export async function readWorkOrder(file: File, jobTypes: string[], today: string): Promise<WorkOrderFields> {
  const client = new Anthropic();
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const source =
    file.type === "application/pdf"
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
      : ({ type: "image", source: { type: "base64", media_type: file.type as ImageType, data } } as const);

  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(WorkOrderSchema) },
    system:
      "You read work orders for a pavement striping, sealcoating and pavement marking company and pull out the job details. " +
      "Copy names, addresses, numbers and quantities exactly as printed. Use null for anything the document doesn't state; never guess. " +
      `Today is ${today}; write dates as YYYY-MM-DD.`,
    messages: [
      {
        role: "user",
        content: [
          source,
          { type: "text", text: `Extract this work order. Known job types: ${jobTypes.join(", ") || "(none yet)"}.` },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("The work order couldn't be read. Please fill in the job by hand.");
  if (!response.parsed_output) throw new Error("The work order couldn't be read clearly. Please check the fields by hand.");
  return response.parsed_output;
}
