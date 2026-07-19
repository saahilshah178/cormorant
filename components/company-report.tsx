import { ExternalLinkIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { OneClickContact } from "@/components/one-click-contact";
import { sectorColor, sectorLabel } from "@/lib/sectors";
import type { DealflowCompany, DealflowSignal } from "@/lib/dealflow";
import { cn } from "@/lib/utils";

/**
 * The evidence-backed company report (PLAN.md 3.1), reused by the board's
 * expanded card and the map's drill-down panel: fit rationale, an honest
 * confidence badge, cited signals as clickable source links, and the
 * one-line pass reason (the bear case).
 */

const STAGE_TEXT: Record<string, string> = {
  pre_seed: "Pre-seed",
  seed: "Seed",
  series_a: "Series A",
  series_b: "Series B",
};

/**
 * Honesty framing (PLAN.md §5): confidence is about the evidence base, so the
 * label says what the evidence is, not how excited the model sounds.
 */
export function confidenceFraming(company: DealflowCompany): {
  tier: "high" | "moderate" | "speculative";
  label: string;
} {
  const n = company.contributing_signal_ids.length;
  const sources = `${n} ${n === 1 ? "source" : "sources"}`;
  if (company.confidence >= 0.7)
    return { tier: "high", label: `High conviction · ${sources}` };
  if (company.confidence >= 0.45)
    return { tier: "moderate", label: `Moderate evidence · ${sources}` };
  const thin = n === 1 ? "1 thin signal" : `${n} thin signals`;
  return { tier: "speculative", label: `Speculative · ${thin}` };
}

export function ConfidenceBadge({
  company,
  className,
}: {
  company: DealflowCompany;
  className?: string;
}) {
  const { tier, label } = confidenceFraming(company);
  return (
    <Badge
      variant={tier === "speculative" ? "destructive" : "secondary"}
      className={cn(tier === "high" && "bg-foreground/90 text-background", className)}
      title={`Confidence ${company.confidence.toFixed(2)} — reflects the evidence base, not enthusiasm`}
    >
      {label}
    </Badge>
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function SignalItem({ signal }: { signal: DealflowSignal }) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border/70 p-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="capitalize">
          {signal.kind.replace(/_/g, " ")}
        </Badge>
        {signal.source_url && (
          <a
            href={signal.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline underline-offset-2"
          >
            {hostname(signal.source_url)}
            <ExternalLinkIcon className="size-3" />
          </a>
        )}
      </div>
      <p className="text-sm leading-relaxed">{signal.value}</p>
    </li>
  );
}

export function CompanyReport({ company }: { company: DealflowCompany }) {
  const contributing = new Set(company.contributing_signal_ids);
  const cited = company.signals.filter((s) => contributing.has(s.id));
  const otherCount = company.signals.length - cited.length;

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              {company.name}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className="gap-1.5"
              >
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: sectorColor(company.sector) }}
                />
                {sectorLabel(company.sector)}
              </Badge>
              {company.stage && (
                <Badge variant="outline">
                  {STAGE_TEXT[company.stage] ?? company.stage}
                </Badge>
              )}
              {company.website && (
                <a
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline underline-offset-2"
                >
                  {hostname(company.website)}
                  <ExternalLinkIcon className="size-3" />
                </a>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold tabular-nums">
              {company.fit_score}
            </div>
            <div className="text-muted-foreground text-xs">thesis fit</div>
          </div>
        </div>
        <ConfidenceBadge company={company} />
      </header>

      <section>
        <h3 className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">
          Why this fit
        </h3>
        <p className="text-sm leading-relaxed">{company.fit_rationale}</p>
      </section>

      <section className="border-destructive/40 bg-destructive/5 rounded-lg border p-3">
        <h3 className="text-destructive mb-1 text-xs font-medium tracking-wide uppercase">
          The bear case — why pass
        </h3>
        <p className="text-sm leading-relaxed">{company.pass_reason}</p>
      </section>

      <section>
        <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
          Evidence behind this score
        </h3>
        <ul className="flex flex-col gap-2">
          {cited.map((s) => (
            <SignalItem key={s.id} signal={s} />
          ))}
        </ul>
        {otherCount > 0 && (
          <p className="text-muted-foreground mt-2 text-xs">
            {otherCount} more {otherCount === 1 ? "signal" : "signals"} on file
            didn’t drive this score.
          </p>
        )}
      </section>

      <section className="border-border/70 border-t pt-4">
        <OneClickContact
          key={company.id}
          companyId={company.id}
          companyName={company.name}
        />
      </section>
    </article>
  );
}
