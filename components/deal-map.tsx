"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyReport } from "@/components/company-report";
import { OTHER_SECTOR_COLOR, SECTOR_COLORS, sectorLabel } from "@/lib/sectors";
import type { DealflowCompany } from "@/lib/dealflow";
import type { GraphLink, GraphNode } from "@/components/graph-wrapper";

// PLAN.md stack gotcha: the wrapper imports react-force-graph-2d directly and
// owns the ref; only the wrapper goes through dynamic(ssr:false).
const GraphWrapper = dynamic(() => import("@/components/graph-wrapper"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

/**
 * The deal-flow map (PLAN.md 3.3/3.4): the force graph plus the sector
 * legend, the reading hint, and the slide-in CompanyReport panel on node
 * click.
 */
export function DealMap({
  nodes,
  links,
  companies,
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  companies: DealflowCompany[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const selected = companies.find((c) => c.id === selectedId) ?? null;
  const presentSectors = [...new Set(companies.map((c) => c.sector))];
  const legendSectors = presentSectors
    .filter((s): s is string => !!s)
    .sort(
      (a, b) =>
        (SECTOR_COLORS[a] ? 0 : 1) - (SECTOR_COLORS[b] ? 0 : 1) ||
        a.localeCompare(b),
    );

  return (
    <div
      ref={containerRef}
      className="relative min-h-0 w-full flex-1 overflow-hidden"
    >
      {size.width > 0 && size.height > 0 && (
        <GraphWrapper
          nodes={nodes}
          links={links}
          width={size.width}
          height={size.height}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}

      {/* Reading hint + legend (identity is never color-alone). */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-col gap-1.5">
        <p className="text-muted-foreground text-xs">
          Closer to center → higher thesis fit · lines → shared investor or
          adjacent market
        </p>
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {legendSectors.map((sector) => (
            <li
              key={sector}
              className="text-muted-foreground flex items-center gap-1.5 text-xs"
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    SECTOR_COLORS[sector] ?? OTHER_SECTOR_COLOR,
                }}
              />
              {sectorLabel(sector)}
            </li>
          ))}
        </ul>
      </div>

      {/* Slide-in drill-down panel (PLAN.md 3.4). */}
      <aside
        aria-hidden={!selected}
        className={`bg-background absolute inset-y-0 right-0 z-10 w-full max-w-md transform border-l shadow-lg transition-transform duration-300 ${
          selected ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {selected && (
          <div className="h-full overflow-y-auto p-4">
            <div className="mb-2 flex justify-end">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close report"
                onClick={() => setSelectedId(null)}
              >
                <XIcon />
              </Button>
            </div>
            <CompanyReport company={selected} />
          </div>
        )}
      </aside>
    </div>
  );
}
