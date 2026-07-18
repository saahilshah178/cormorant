"use client";

import { useState } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CompanyReport, ConfidenceBadge } from "@/components/company-report";
import { sectorColor, sectorLabel } from "@/lib/sectors";
import type { DealflowCompany } from "@/lib/dealflow";

/**
 * The ranked deal-flow board (PLAN.md 3.2) — the guaranteed fallback view:
 * cards sorted by fit with score, confidence badge, top-3 cited signals, and
 * the pass reason. Click expands into the full CompanyReport.
 */
export function DealBoard({ companies }: { companies: DealflowCompany[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ranked = [...companies].sort((a, b) => b.fit_score - a.fit_score);
  const selected = ranked.find((c) => c.id === selectedId) ?? null;

  return (
    <>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ranked.map((company, i) => {
          const contributing = new Set(company.contributing_signal_ids);
          const topSignals = company.signals
            .filter((s) => contributing.has(s.id))
            .slice(0, 3);
          return (
            <li key={company.id}>
              <Card
                size="sm"
                role="button"
                tabIndex={0}
                aria-label={`Open report for ${company.name}`}
                className="hover:ring-foreground/25 h-full cursor-pointer transition-shadow"
                onClick={() => setSelectedId(company.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(company.id);
                  }
                }}
              >
                <CardHeader>
                  <CardTitle className="flex items-baseline justify-between gap-2">
                    <span className="truncate">
                      <span className="text-muted-foreground mr-1.5 text-xs tabular-nums">
                        #{i + 1}
                      </span>
                      {company.name}
                    </span>
                    <span className="text-lg font-semibold tabular-nums">
                      {company.fit_score}
                    </span>
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="gap-1.5">
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{ backgroundColor: sectorColor(company.sector) }}
                      />
                      {sectorLabel(company.sector)}
                    </Badge>
                    <ConfidenceBadge company={company} />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <ul className="flex flex-col gap-1">
                    {topSignals.map((s) => (
                      <li
                        key={s.id}
                        className="text-muted-foreground line-clamp-2 text-xs leading-snug"
                      >
                        <Badge
                          variant="outline"
                          className="mr-1 h-4 px-1.5 text-[10px] capitalize align-middle"
                        >
                          {s.kind.replace(/_/g, " ")}
                        </Badge>
                        {s.value}
                        {s.source_url && (
                          <ExternalLinkIcon className="ml-1 inline size-3 align-[-2px]" />
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="border-destructive/40 text-muted-foreground line-clamp-2 border-l-2 pl-2 text-xs leading-snug">
                    <span className="text-destructive font-medium">Pass: </span>
                    {company.pass_reason}
                  </p>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => !open && setSelectedId(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {selected && (
            <>
              <DialogTitle className="sr-only">
                {selected.name} — company report
              </DialogTitle>
              <CompanyReport company={selected} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
