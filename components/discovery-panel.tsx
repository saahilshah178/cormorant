"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2Icon,
  PlusIcon,
  RadarIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Discovery settings panel (PLAN.md 4.4): mode toggle (batch w/ target count
 * vs continuous), start/stop, persistent free-text instructions, and the live
 * agent-activity log read from the run's namespaced streams
 * (logs:scraper / logs:review / logs:grading).
 *
 * The run itself is a durable background workflow: closing the tab never
 * stops it. This component polls /api/discovery/status while a run is live
 * (even with the dialog closed) and calls onRefresh so discovered companies
 * drop onto the map as they're scored (4.5). On mount it reattaches to
 * whatever the latest run is — including one that finished while the tab was
 * closed.
 */

type DiscoveryRun = {
  id: string;
  mode: "batch" | "continuous";
  target_count: number | null;
  status: "running" | "stopped" | "completed" | "failed";
  workflow_run_id: string | null;
  companies_found: number;
  started_at: string;
  stopped_at: string | null;
};

type Instruction = { id: string; text: string };

type LogEntry = { agent: "scraper" | "review" | "grading"; line: string };

const AGENT_COLORS: Record<LogEntry["agent"], string> = {
  scraper: "text-sky-700 dark:text-sky-400",
  review: "text-amber-700 dark:text-amber-400",
  grading: "text-emerald-700 dark:text-emerald-400",
};

export function DiscoveryPanel({
  onRefresh,
}: {
  onRefresh: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState<DiscoveryRun | null>(null);
  const [mode, setMode] = useState<"batch" | "continuous">("batch");
  const [target, setTarget] = useState(5);
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [draft, setDraft] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    const res = await fetch("/api/discovery/status", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setRun(data.run ?? null);
  }, []);

  const fetchInstructions = useCallback(async () => {
    const res = await fetch("/api/discovery/instructions", {
      cache: "no-store",
    });
    const data = await res.json();
    if (res.ok) setInstructions(data.instructions ?? []);
  }, []);

  // Reattach on mount: find the latest run (maybe finished while tab closed).
  useEffect(() => {
    // False positive: every setState inside these happens after an await
    // (the fetch), never synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStatus().catch(() => {});
    fetchInstructions().catch(() => {});
  }, [fetchStatus, fetchInstructions]);

  // While a run is live, poll status and refresh the map so new nodes drop in
  // — dialog open or not (the run is a background job, not a modal state).
  const running = run?.status === "running";
  useEffect(() => {
    if (!running) return;
    const refresh = () => Promise.resolve(onRefresh()).catch(() => {});
    const t = setInterval(() => {
      fetchStatus().catch(() => {});
      refresh();
    }, 3000);
    return () => {
      clearInterval(t);
      refresh(); // one last refresh when the run leaves "running"
    };
  }, [running, fetchStatus, onRefresh]);

  // Live agent-activity log: three namespaced stream readers while open.
  // Streams replay from the start, so reopening shows the full history.
  const wfRunId = run?.workflow_run_id ?? null;
  useEffect(() => {
    if (!open || !wfRunId) return;
    const ctrl = new AbortController();
    // Streams replay from index 0 on every subscribe, so the accumulated log
    // must reset exactly when the readers (re)start or lines duplicate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLog([]);
    for (const agent of ["scraper", "review", "grading"] as const) {
      (async () => {
        const res = await fetch(
          `/api/discovery/stream?workflowRunId=${encodeURIComponent(wfRunId)}&namespace=${encodeURIComponent(`logs:${agent}`)}`,
          { signal: ctrl.signal, cache: "no-store" },
        );
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          const entries = lines
            .filter((l) => l.trim())
            .map((line) => ({ agent, line }));
          if (entries.length) {
            setLog((prev) => [...prev, ...entries].slice(-300));
          }
        }
      })().catch(() => {
        // aborted on close / stream ended — fine
      });
    }
    return () => ctrl.abort();
  }, [open, wfRunId]);

  const startRun = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/discovery/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, targetCount: target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRun(data.run);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [mode, target]);

  const stopRun = useCallback(async () => {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/discovery/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [run, fetchStatus]);

  const addInstruction = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setError(null);
    try {
      const res = await fetch("/api/discovery/instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDraft("");
      await fetchInstructions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [draft, fetchInstructions]);

  const removeInstruction = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await fetch("/api/discovery/instructions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        await fetchInstructions();
      } catch {
        // list refetch below will show the truth
      }
    },
    [fetchInstructions],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <RadarIcon className={cn(running && "animate-pulse text-emerald-600")} />
        Discovery
        {running && (
          <span className="text-muted-foreground tabular-nums">
            {run?.companies_found ?? 0} found
          </span>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Live discovery</DialogTitle>
          <DialogDescription>
            A durable background pipeline — parallel scraper agents over public
            sources, review agents that verify citations, and the same grading
            engine as the preset set. Closing this tab does not stop a run.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border p-2 text-xs">
            {error}
          </div>
        )}

        {running ? (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="text-sm">
              <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-emerald-500" />
              {run?.mode === "batch"
                ? `Batch run · ${run?.companies_found ?? 0}/${run?.target_count} companies found`
                : `Continuous run · ${run?.companies_found ?? 0} companies found`}
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={stopRun}
              disabled={busy}
            >
              {busy ? <Loader2Icon className="animate-spin" /> : <SquareIcon />}
              Stop
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">Mode</span>
              <div
                role="group"
                aria-label="Discovery mode"
                className="border-border flex rounded-lg border p-0.5"
              >
                {(["batch", "continuous"] as const).map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant={mode === m ? "secondary" : "ghost"}
                    aria-pressed={mode === m}
                    className="capitalize"
                    onClick={() => setMode(m)}
                  >
                    {m}
                  </Button>
                ))}
              </div>
            </div>
            {mode === "batch" && (
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="discovery-target"
                  className="text-muted-foreground text-xs"
                >
                  Target companies
                </label>
                <Input
                  id="discovery-target"
                  type="number"
                  min={1}
                  max={25}
                  value={target}
                  onChange={(e) =>
                    setTarget(
                      Math.min(25, Math.max(1, Number(e.target.value) || 1)),
                    )
                  }
                  className="w-24"
                />
              </div>
            )}
            <Button onClick={startRun} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <RadarIcon />}
              Start {mode === "batch" ? `batch (${target})` : "continuous"} run
            </Button>
            {run && (
              <p className="text-muted-foreground w-full text-xs">
                Last run: {run.mode} · {run.status} · {run.companies_found}{" "}
                companies found
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">
            Standing instructions to the agents
          </span>
          {instructions.length > 0 && (
            <ul className="flex flex-col gap-1">
              {instructions.map((ins) => (
                <li
                  key={ins.id}
                  className="bg-muted/50 flex items-start justify-between gap-2 rounded-md px-2 py-1 text-xs"
                >
                  <span>{ins.text}</span>
                  <button
                    aria-label="Remove instruction"
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() => removeInstruction(ins.id)}
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input
              placeholder='e.g. "prioritize fintech infra, avoid consumer social"'
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addInstruction();
              }}
            />
            <Button variant="outline" size="sm" onClick={addInstruction}>
              <PlusIcon /> Add
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Every active instruction is fed to the scraper, review, and grading
            agents on all future rounds.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium">Agent activity</span>
          <div className="bg-muted/30 h-48 overflow-y-auto rounded-lg border p-2 font-mono text-[11px] leading-relaxed">
            {log.length === 0 ? (
              <p className="text-muted-foreground">
                {wfRunId
                  ? "No activity yet."
                  : "Start a run to see the agents work."}
              </p>
            ) : (
              log.map((entry, i) => (
                <div key={i} className="flex gap-2">
                  <span
                    className={cn(
                      "w-16 shrink-0 font-semibold",
                      AGENT_COLORS[entry.agent],
                    )}
                  >
                    {entry.agent}
                  </span>
                  <span className="break-all whitespace-pre-wrap">
                    {entry.line}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
