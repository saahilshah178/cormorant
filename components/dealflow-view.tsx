"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2Icon, PlayIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DealBoard } from "@/components/deal-board";
import { DealMap } from "@/components/deal-map";
import { DiscoveryPanel } from "@/components/discovery-panel";
import type { DealflowPayload } from "@/lib/dealflow";
import type { GraphLink, GraphNode } from "@/components/graph-wrapper";
import { seedNodePosition } from "@/lib/graph-layout";
import { cn } from "@/lib/utils";

/**
 * The deal-flow screen (PLAN.md Tier 3): one data layer feeding both the map
 * and the board (3.5 — toggling never refetches).
 *
 * - "Run scoring" POSTs /api/score for the active thesis and polls
 *   /api/dealflow while it runs, so newly scored companies drop onto the map
 *   live (demo step 2).
 * - thesisId comes from the server page (cookie-resolved); when the header
 *   selector changes it, the effect refetches and the SAME node objects get
 *   new fit values — the map reheats and the pool visibly reorders (3.4).
 */
export function DealflowView({
  thesisId,
  thesisName,
}: {
  thesisId: string;
  thesisName: string;
}) {
  const [payload, setPayload] = useState<DealflowPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "board">("map");
  const [running, setRunning] = useState(false);
  const [runSummary, setRunSummary] = useState<string | null>(null);
  // Id of a thesis that was just edited (its scores were cleared server-side,
  // so its map is stale until rescored). The prompt shows only while this
  // matches the thesis on screen, so switching thesis hides it automatically.
  const [rescoreThesisId, setRescoreThesisId] = useState<string | null>(null);

  // Node objects are cached by company id and MUTATED on refetch, so the
  // force simulation keeps positions across polls and thesis swaps — that's
  // what makes the resettle an animation instead of a re-layout.
  const nodeCache = useRef(new Map<string, GraphNode>());
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>(
    { nodes: [], links: [] },
  );

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/dealflow?thesisId=${thesisId}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    const typed = data as DealflowPayload;
    setPayload(typed);
    setError(null);

    const nodes = typed.companies.map((c) => {
      const existing = nodeCache.current.get(c.id);
      if (existing) {
        existing.fit = c.fit_score;
        existing.confidence = c.confidence;
        existing.sector = c.sector;
        existing.name = c.name;
        return existing;
      }
      const created: GraphNode = {
        id: c.id,
        name: c.name,
        sector: c.sector,
        fit: c.fit_score,
        confidence: c.confidence,
        // Stable slot = cache size at creation: a monotonic index across every
        // node ever created. It fixes this node's angle for the life of the
        // session, so the graph anchors the whole pool to evenly-fanned slots
        // and new nodes never pile onto one arc.
        slot: nodeCache.current.size,
      };
      // Seed the node ON its anchor target so it appears in place instead of
      // flying in from the center. Only brand-new nodes are seeded; cached ones
      // keep their settled positions.
      seedNodePosition(created);
      nodeCache.current.set(c.id, created);
      return created;
    });
    const links: GraphLink[] = typed.edges.map((e) => ({ ...e }));
    setGraph({ nodes, links });
  }, [thesisId]);

  useEffect(() => {
    let cancelled = false;
    // False positive: every setState inside fetchData happens after an await
    // (the fetch), never synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData().catch((err) => {
      if (!cancelled)
        setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [fetchData]);

  // Prompt a rescore when a thesis is edited elsewhere (the header Thesis menu).
  // The edit already cleared that thesis's scores server-side, so its map is
  // stale until rescored; the banner renders only while the edited id is the
  // one on screen (see rescoreThesisId).
  useEffect(() => {
    function onThesisUpdated(event: Event) {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (id) setRescoreThesisId(id);
    }
    window.addEventListener("cormorant:thesis-updated", onThesisUpdated);
    return () =>
      window.removeEventListener("cormorant:thesis-updated", onThesisUpdated);
  }, []);

  const runScoring = useCallback(async () => {
    setRunning(true);
    setRunSummary(null);
    setError(null);
    setRescoreThesisId(null);
    const poll = setInterval(() => {
      fetchData().catch(() => {}); // transient poll errors are fine
    }, 2500);
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thesisId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const parts = [
        data.scored > 0 && `${data.scored} newly scored`,
        data.reused_cached > 0 && `${data.reused_cached} already scored`,
        data.failed?.length > 0 && `${data.failed.length} failed`,
      ].filter(Boolean);
      setRunSummary(parts.join(" · ") || "Nothing to score");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(poll);
      await fetchData().catch((err) => setError(err.message));
      setRunning(false);
    }
  }, [thesisId, fetchData]);

  const scoredCount = payload?.companies.length ?? 0;
  const totalCount = payload?.total_companies ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-semibold tracking-tight">Deal flow</h1>
          <p className="text-muted-foreground text-sm">
            {thesisName} ·{" "}
            {running ? (
              <span className="text-foreground">
                scoring… {scoredCount}/{totalCount}
              </span>
            ) : (
              `${scoredCount} of ${totalCount} companies scored`
            )}
            {runSummary && !running && (
              <span className="text-muted-foreground"> · {runSummary}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DiscoveryPanel onRefresh={fetchData} />
          <Button size="sm" onClick={runScoring} disabled={running}>
            {running ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <PlayIcon />
            )}
            {running
              ? "Scoring…"
              : scoredCount < totalCount
                ? `Score ${totalCount - scoredCount} companies`
                : "Run scoring"}
          </Button>
          <div
            role="group"
            aria-label="View"
            className="border-border flex rounded-lg border p-0.5"
          >
            {(["map", "board"] as const).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={view === v ? "secondary" : "ghost"}
                aria-pressed={view === v}
                className="capitalize"
                onClick={() => setView(v)}
              >
                {v}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {rescoreThesisId === thesisId && !running && (
        <div className="mx-6 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <span className="text-amber-900 dark:text-amber-200">
            This thesis changed. Rerun scoring to update the deal flow against
            the edited thesis.
          </span>
          <Button size="sm" onClick={runScoring}>
            <PlayIcon /> Rerun scoring
          </Button>
        </div>
      )}

      {error && (
        <div className="border-destructive/40 bg-destructive/5 text-destructive mx-6 mt-4 rounded-lg border p-3 text-sm">
          {error}{" "}
          <button
            className="underline underline-offset-2"
            onClick={() => fetchData().catch((err) => setError(err.message))}
          >
            Retry
          </button>
        </div>
      )}

      {!payload && !error ? (
        <div className="flex flex-1 flex-col gap-3 p-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="min-h-96 flex-1" />
        </div>
      ) : payload && scoredCount === 0 && !running ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <Card className="max-w-md">
            <CardContent className="flex flex-col items-start gap-3 pt-2">
              <h2 className="text-lg font-semibold">
                No companies scored for this thesis yet
              </h2>
              <p className="text-muted-foreground text-sm">
                Run the scoring engine: every one of the {totalCount} indexed
                companies gets a fit score against “{thesisName}”, with cited
                evidence and an honest reason to pass. Companies land on the
                map as they’re scored.
              </p>
              <div className="flex gap-2">
                <Button onClick={runScoring} disabled={running}>
                  <PlayIcon /> Run scoring
                </Button>
                <Link
                  href="/onboarding"
                  className={cn(buttonVariants({ variant: "outline" }))}
                >
                  New thesis
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : view === "map" ? (
        <div className="flex min-h-[520px] flex-1">
          <DealMap
            nodes={graph.nodes}
            links={graph.links}
            companies={payload?.companies ?? []}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          <DealBoard companies={payload?.companies ?? []} />
        </div>
      )}
    </div>
  );
}
