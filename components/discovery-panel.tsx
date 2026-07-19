"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2Icon, RadarIcon, SquareIcon } from "lucide-react";
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
 * Discovery settings panel (PLAN.md 4.4): a target-count input that finds
 * exactly that many companies, start/stop, and the live agent-activity log
 * read from the run's namespaced streams (logs:scraper / logs:review /
 * logs:grading). The agents are steered by the active thesis alone — to change
 * what discovery looks for, edit the thesis or switch to another one.
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
  target_count: number | null;
  status: "running" | "stopped" | "completed" | "failed";
  workflow_run_id: string | null;
  companies_found: number;
  started_at: string;
  stopped_at: string | null;
};

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
  const [target, setTarget] = useState(5);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    const res = await fetch("/api/discovery/status", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setRun(data.run ?? null);
  }, []);

  // Reattach on mount: find the latest run (maybe finished while tab closed).
  useEffect(() => {
    // False positive: every setState inside this happens after an await
    // (the fetch), never synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStatus().catch(() => {});
  }, [fetchStatus]);

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
        body: JSON.stringify({ targetCount: target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRun(data.run);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [target]);

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <RadarIcon className={cn(running && "animate-pulse text-emerald-600")} />
        Discovery
        {running && (
          <span className="text-muted-foreground tabular-nums">
            {run?.companies_found ?? 0}/{run?.target_count ?? "?"} found
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
              {`Discovering · ${run?.companies_found ?? 0}/${run?.target_count} companies found`}
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
              <label
                htmlFor="discovery-target"
                className="text-muted-foreground text-xs"
              >
                Companies to find
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
            <Button onClick={startRun} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <RadarIcon />}
              Find {target} {target === 1 ? "company" : "companies"}
            </Button>
            {run && (
              <p className="text-muted-foreground w-full text-xs">
                Last run: {run.status} · {run.companies_found} of{" "}
                {run.target_count} companies found
              </p>
            )}
          </div>
        )}

        <p className="text-muted-foreground text-xs">
          The agents follow the active thesis — its stages, industries, and
          written focus steer scraping, review, and grading. To steer discovery
          differently, edit the thesis or switch to another one.
        </p>

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
