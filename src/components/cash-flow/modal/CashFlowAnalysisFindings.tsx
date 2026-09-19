/**
 * The four analytical sections of the model's answer, on the screen that asked
 * for them.
 *
 * `compare-cash-flow-reports` has always asked for eight sections and the panel
 * has always drawn four: the executive summary, the rankings, the investor
 * recommendations and the best property. Cash flow trajectory, capital growth,
 * yield and risk were requested, generated, paid for and thrown away — and the
 * typeset PDF drew all eight, so the document an adviser downloaded said more
 * than the screen they were reading. These are those four.
 *
 * Two rules hold them.
 *
 * **A property number is resolved through the model's own rankings, never
 * through our position in a list.** Every block but the rankings names a
 * property by the 1-based index the producer sent, and "Property 3" on a screen
 * comparing five houses is a number a reader has to decode. The obvious
 * resolution — index into `[the open report, ...the ones being compared]` — is
 * wrong for a SAVED analysis: `cash_flow_analyses` stores its comparison ids
 * sorted while the panel holds them in selection order, so re-opening one can
 * put the numbers against different houses. `finalRankings` carries both the
 * number and the address the model echoed, it is the one part of the answer
 * that does, and it travels with the analysis through the save. So the map is
 * built from it and matched back to a real property, and a number that resolves
 * to nothing drops its row rather than being labelled with a guess.
 *
 * **Nothing here is a winner's podium for being worst.** `highestRisk` stays in
 * prose beside its reasons, and what the analysis would avoid sits with the
 * risk it belongs to rather than beside the ranking — `CASH_FLOW_COMPARISON.md`
 * records why naming a property to avoid next to the table that ranks it is a
 * different act from ranking it last.
 */
import type { ReactNode } from 'react';
import { Activity, AlertTriangle, Percent, TrendingUp } from 'lucide-react';

/** A property in this comparison, by the number the producer gave the model. */
export interface FindingProperty {
  number: number;
  address: string;
}

export interface CashFlowAnalysisFindingsProps {
  /** The model's analysis, exactly as it arrived. */
  analysis: Record<string, unknown> | null | undefined;
  properties: readonly FindingProperty[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The street line, which is what tells two properties apart at a glance. */
const streetOf = (address: string): string => address.split(',')[0]?.trim() || address;

/** Case- and whitespace-insensitive, for matching a model's echo of an address. */
const addressKey = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();

export function CashFlowAnalysisFindings({ analysis, properties }: CashFlowAnalysisFindingsProps) {
  if (!isRecord(analysis)) return null;

  // The real properties, by the two spellings a model plausibly echoes.
  const byAddress = new Map<string, FindingProperty>();
  for (const property of properties) {
    byAddress.set(addressKey(property.address), property);
    const street = addressKey(streetOf(property.address));
    if (!byAddress.has(street)) byAddress.set(street, property);
  }

  const byNumber = new Map<number, string>();
  for (const row of list(analysis.finalRankings).filter(isRecord)) {
    const n = Math.trunc(Number(row.propertyNumber));
    if (!Number.isFinite(n) || byNumber.has(n)) continue;
    const stated = text(row.address);
    if (!stated) continue;
    const matched = byAddress.get(addressKey(stated)) ?? byAddress.get(addressKey(streetOf(stated)));
    // Our address when it matches one, and what the model claimed when it does
    // not — a reader can then see the claim rather than a row quietly pointing
    // at the wrong property.
    byNumber.set(n, matched ? streetOf(matched.address) : streetOf(stated));
  }

  const nameOf = (value: unknown): string | null => {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return null;
    return byNumber.get(Math.trunc(n)) ?? null;
  };

  const trajectory = isRecord(analysis.cashFlowTrajectory) ? analysis.cashFlowTrajectory : null;
  const growth = isRecord(analysis.capitalGrowth) ? analysis.capitalGrowth : null;
  const yields = isRecord(analysis.yieldAnalysis) ? analysis.yieldAnalysis : null;
  const risk = isRecord(analysis.riskAssessment) ? analysis.riskAssessment : null;
  const recommendation = isRecord(analysis.overallRecommendation) ? analysis.overallRecommendation : null;
  const avoid = list(recommendation?.avoid).filter(isRecord);

  return (
    <>
      {trajectory && (
        <FindingCard icon={<Activity className="h-4 w-4 shrink-0 text-brand-300" />} title="Cash Flow Trajectory">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Named
              label="Reaches positive cash flow first"
              name={nameOf((trajectory.fastestPositiveCashFlow as Record<string, unknown>)?.propertyNumber)}
              detail={text((trajectory.fastestPositiveCashFlow as Record<string, unknown>)?.reason)}
              badge={text((trajectory.fastestPositiveCashFlow as Record<string, unknown>)?.timeframe)}
            />
            <Named
              label="Strongest cash flow growth"
              name={nameOf((trajectory.strongestGrowth as Record<string, unknown>)?.propertyNumber)}
              detail={text((trajectory.strongestGrowth as Record<string, unknown>)?.reason)}
            />
          </div>
          <Concerns
            label="Patterns worth watching"
            items={list(trajectory.concerns).filter(isRecord).map((c) => ({
              name: nameOf(c.propertyNumber),
              detail: text(c.concern) || text(c.reason),
            }))}
          />
        </FindingCard>
      )}

      {growth && (
        <FindingCard icon={<TrendingUp className="h-4 w-4 shrink-0 text-brand-300" />} title="Capital Growth">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Named
              label="Strongest equity accumulation"
              name={nameOf((growth.strongestEquity as Record<string, unknown>)?.propertyNumber)}
              detail={text((growth.strongestEquity as Record<string, unknown>)?.reason)}
              badge={text((growth.strongestEquity as Record<string, unknown>)?.year10Equity)}
            />
            <Named
              label="Best wealth builder"
              name={nameOf((growth.wealthBuilder as Record<string, unknown>)?.propertyNumber)}
              detail={text((growth.wealthBuilder as Record<string, unknown>)?.reason)}
            />
          </div>
          <ValueRows
            label="Projected at year 10"
            rows={list(growth.year10Values).filter(isRecord).map((v) => ({
              name: nameOf(v.propertyNumber),
              value: text(v.value),
              equity: text(v.equity),
            }))}
          />
        </FindingCard>
      )}

      {yields && (
        <FindingCard icon={<Percent className="h-4 w-4 shrink-0 text-brand-300" />} title="Yield & Return">
          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            <Named
              label="Best gross yield"
              name={nameOf((yields.bestGrossYield as Record<string, unknown>)?.propertyNumber)}
              badge={text((yields.bestGrossYield as Record<string, unknown>)?.value)}
              detail={text((yields.bestGrossYield as Record<string, unknown>)?.reason)}
            />
            <Named
              label="Best net yield"
              name={nameOf((yields.bestNetYield as Record<string, unknown>)?.propertyNumber)}
              badge={text((yields.bestNetYield as Record<string, unknown>)?.value)}
              detail={text((yields.bestNetYield as Record<string, unknown>)?.reason)}
            />
            <Named
              label="Best 10-year return"
              name={nameOf((yields.best10YearROI as Record<string, unknown>)?.propertyNumber)}
              badge={text((yields.best10YearROI as Record<string, unknown>)?.value)}
              detail={text((yields.best10YearROI as Record<string, unknown>)?.reason)}
            />
          </div>
        </FindingCard>
      )}

      {(risk || avoid.length > 0) && (
        <FindingCard
          icon={<AlertTriangle className="h-4 w-4 shrink-0 text-brand-300" />}
          title="Risk, and what to avoid"
        >
          {risk && (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Named
                label="Most stable projection"
                name={nameOf((risk.mostStable as Record<string, unknown>)?.propertyNumber)}
                detail={text((risk.mostStable as Record<string, unknown>)?.reason)}
              />
              <Named
                label="Carries the most risk"
                name={nameOf((risk.highestRisk as Record<string, unknown>)?.propertyNumber)}
                detail={text((risk.highestRisk as Record<string, unknown>)?.reason)}
                bullets={list((risk.highestRisk as Record<string, unknown>)?.risks).map(text).filter(Boolean)}
              />
            </div>
          )}
          {risk && (
            <ValueRows
              label="Break-even and safety margin"
              rows={list(risk.breakEvenAnalysis).filter(isRecord).map((b) => ({
                name: nameOf(b.propertyNumber),
                value: text(b.breakEvenYear),
                equity: text(b.safetyMargin),
              }))}
              valueLabel="Break-even"
              equityLabel="Safety margin"
            />
          )}
          <Concerns
            label="The analysis would avoid"
            items={avoid.map((a) => ({ name: nameOf(a.propertyNumber), detail: text(a.reason) }))}
            tone="destructive"
          />
        </FindingCard>
      )}
    </>
  );
}

function FindingCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-3 rounded-2xl border border-brand-300/25 bg-gradient-to-br from-card dark:from-background via-card dark:via-background to-card dark:to-background p-4 shadow-lg shadow-sm dark:shadow-black/20 ring-1 ring-brand-400/10 sm:p-5">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-brand-100">
        {icon}
        <span>{title}</span>
      </h4>
      {children}
    </div>
  );
}

/**
 * One named property and why it was named.
 *
 * Drawn only when the property resolves. A block whose every entry is
 * unresolvable therefore draws nothing rather than a row of blanks.
 */
function Named({
  label,
  name,
  detail,
  badge,
  bullets,
}: {
  label: string;
  name: string | null;
  detail?: string;
  badge?: string;
  bullets?: string[];
}) {
  if (!name) return null;
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-background/60 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="min-w-0 text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{name}</span>
        {badge && (
          <span className="max-w-full rounded-full bg-brand-400/10 px-2 py-0.5 text-[10px] font-medium text-brand-200 ring-1 ring-brand-300/20 [overflow-wrap:anywhere]">
            {badge}
          </span>
        )}
      </div>
      {detail && (
        <p className="mt-1.5 whitespace-normal text-xs leading-6 text-muted-foreground dark:text-foreground [overflow-wrap:anywhere]">
          {detail}
        </p>
      )}
      {bullets && bullets.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          {bullets.map((item, i) => (
            <li
              key={i}
              className="whitespace-normal text-xs leading-6 text-muted-foreground dark:text-foreground [overflow-wrap:anywhere]"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Concerns({
  label,
  items,
  tone = 'warning',
}: {
  label: string;
  items: { name: string | null; detail: string }[];
  tone?: 'warning' | 'destructive';
}) {
  const rows = items.filter((i) => i.name && i.detail);
  if (!rows.length) return null;
  const ring = tone === 'destructive' ? 'border-destructive/30 bg-destructive/5' : 'border-warning/30 bg-warning/5';
  const ink = tone === 'destructive' ? 'text-destructive' : 'text-warning';
  return (
    <div className={`min-w-0 space-y-2 rounded-xl border ${ring} p-3`}>
      <p className={`text-[10px] font-medium uppercase tracking-wide ${ink}`}>{label}</p>
      {rows.map((row, i) => (
        <p
          key={i}
          className="whitespace-normal text-xs leading-6 text-muted-foreground dark:text-foreground [overflow-wrap:anywhere]"
        >
          <span className="font-medium text-foreground">{row.name}: </span>
          {row.detail}
        </p>
      ))}
    </div>
  );
}

function ValueRows({
  label,
  rows,
  valueLabel = 'Value',
  equityLabel = 'Equity',
}: {
  label: string;
  rows: { name: string | null; value: string; equity: string }[];
  valueLabel?: string;
  equityLabel?: string;
}) {
  const shown = rows.filter((r) => r.name && (r.value || r.equity));
  if (!shown.length) return null;
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-background/40 p-3">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="space-y-1.5">
        {shown.map((row, i) => (
          <div key={i} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="min-w-0 text-xs font-medium text-foreground [overflow-wrap:anywhere]">{row.name}</span>
            {/* Never `shrink-0`. At 390px "Break-even: Beyond year 10 · Safety
                margin: -$310/week" is 345px of content in a 232px row, and a
                cluster that may not shrink simply hangs off the card and is
                clipped by its own rounded edge — the figure a reader most
                needs, cut in half. `shrink-0` protects a cluster's width, not
                its contents. */}
            <span className="min-w-0 text-xs tabular-nums text-muted-foreground dark:text-foreground [overflow-wrap:anywhere] sm:text-right">
              {row.value && <span>{valueLabel}: {row.value}</span>}
              {row.value && row.equity && <span aria-hidden> · </span>}
              {row.equity && <span>{equityLabel}: {row.equity}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
