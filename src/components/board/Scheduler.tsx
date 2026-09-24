"use client";

import { createContext, useCallback, useContext, useState, useTransition, type ReactNode } from "react";
import type { ConfirmOptions, ScheduleResult } from "@/app/actions/schedule";
import type { Finding } from "@/lib/engine/types";
import { ConflictDialog } from "./ConflictDialog";

type Action = (opts: ConfirmOptions) => Promise<ScheduleResult>;

interface Pending {
  findings: Finding[];
  summary: string;
  action: Action;
  verb: string;
  onDone?: (r: ScheduleResult) => void;
}

interface SchedulerApi {
  /** Run a scheduling action; if it would introduce conflicts, ask the user first. */
  run: (action: Action, opts?: { verb?: string; onDone?: (r: ScheduleResult) => void }) => void;
  busy: boolean;
  toast: (message: string, tone?: "info" | "error" | "success") => void;
}

const Ctx = createContext<SchedulerApi | null>(null);

export function useScheduler() {
  const api = useContext(Ctx);
  if (!api) throw new Error("useScheduler must be used inside <SchedulerProvider>");
  return api;
}

export function SchedulerProvider({ children }: { children: ReactNode }) {
  const [busy, startTransition] = useTransition();
  const [pending, setPending] = useState<Pending | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string; tone: string }[]>([]);

  const toast = useCallback((message: string, tone: "info" | "error" | "success" = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3500);
  }, []);

  const handle = useCallback(
    (result: ScheduleResult, action: Action, verb: string, onDone?: (r: ScheduleResult) => void) => {
      if (result.ok) {
        if (result.overridden) toast("Saved with override — recorded in the activity log.", "success");
        onDone?.(result);
      } else if (result.needsConfirm) {
        setPending({ findings: result.findings, summary: result.summary, action, verb, onDone });
      } else {
        toast(result.error, "error");
      }
    },
    [toast],
  );

  const run = useCallback<SchedulerApi["run"]>(
    (action, opts = {}) => {
      startTransition(async () => {
        const result = await action({});
        handle(result, action, opts.verb ?? "Proceed anyway", opts.onDone);
      });
    },
    [handle],
  );

  const confirm = (reason: string) => {
    if (!pending) return;
    const { action, onDone } = pending;
    setPending(null);
    startTransition(async () => {
      const result = await action({ override: true, reason });
      if (result.ok) {
        toast("Change saved. Override recorded.", "success");
        onDone?.(result);
      } else if (!result.needsConfirm) toast(result.error, "error");
      else toast("The schedule changed while you were deciding. Please try again.", "error");
    });
  };

  return (
    <Ctx.Provider value={{ run, busy, toast }}>
      {children}
      {pending && (
        <ConflictDialog findings={pending.findings} summary={pending.summary} verb={pending.verb} onCancel={() => setPending(null)} onConfirm={confirm} />
      )}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,28rem)] -translate-x-1/2 flex-col gap-2">
        {busy && <div className="rounded-lg bg-slate-900/90 px-3 py-2 text-center text-sm text-white shadow-lg">Saving…</div>}
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              "rounded-lg px-3 py-2 text-sm font-medium shadow-lg " +
              (t.tone === "error" ? "bg-red-600 text-white" : t.tone === "success" ? "bg-emerald-600 text-white" : "bg-slate-900 text-white")
            }
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
