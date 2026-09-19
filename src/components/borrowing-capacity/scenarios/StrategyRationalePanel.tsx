/**
 * Strategy Rationale Panel — Phase F5
 * ────────────────────────────────────
 * Renders the deterministic narrative produced by `buildStrategyRationale`
 * as a finance-ready brief. Designed to slot directly under the Purchase
 * Power headline inside the Strategy Builder.
 *
 * Sections:
 *   1. Headline + sub-headline (target framing)
 *   2. What & Why bullets (sorted by material impact)
 *   3. Reconciliation paragraph
 *   4. Recommended execution sequence (numbered, owner-coded)
 *   5. Caveats / assumptions
 *
 * Includes a "Copy brief" action so the broker can paste the rationale
 * straight into an email or hand-off note to the finance division
 * (precursor to the F6 export packaging).
 */

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { Separator } from '@/components/ui/separator';
import {
  ScrollText,
  ListChecks,
  AlertTriangle,
  ShieldAlert,
  Clipboard,
  ClipboardCheck,
  ArrowRight,
  Scale,
  Sparkles,
  FileDown,
  Loader2,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import type { RationaleReport, RationaleSeverity, RationaleCapitalFlowEntry } from '@/utils/strategyRationaleEngine';
import { generateStrategyRationalePDF, type RationalePDFContext } from './StrategyRationalePDF';

interface StrategyRationalePanelProps {
  report: RationaleReport;
  /** Same currency formatter the parent uses. */
  formatCurrency: (n: number) => string;
  /** Context required to render a finance-ready PDF brief. When omitted the
   *  PDF download button is hidden (e.g. preview surfaces without client info). */
  pdfContext?: RationalePDFContext;
}

// Map severity → semantic-token-aware Tailwind classes (no raw colors)
const SEVERITY_CLASSES: Record<RationaleSeverity, { badge: string; ring: string; text: string }> = {
  positive: {
    badge: 'bg-success/10 text-success border-success/30 dark:text-success',
    ring: 'border-l-emerald-500',
    text: 'text-success dark:text-success',
  },
  caution: {
    badge: 'bg-brand-500/10 text-brand-700 border-brand-500/30 dark:text-brand-400',
    ring: 'border-l-amber-500',
    text: 'text-brand-700 dark:text-brand-400',
  },
  critical: {
    badge: 'bg-destructive/10 text-destructive border-destructive/30',
    ring: 'border-l-destructive',
    text: 'text-destructive',
  },
  info: {
    badge: 'bg-muted text-muted-foreground border-border',
    ring: 'border-l-muted-foreground/40',
    text: 'text-muted-foreground',
  },
};

const OWNER_LABEL: Record<'broker' | 'finance' | 'client', string> = {
  broker: 'Broker',
  finance: 'Finance',
  client: 'Client',
};

const OWNER_BADGE: Record<'broker' | 'finance' | 'client', string> = {
  broker: 'bg-primary/10 text-primary border-primary/30',
  finance: 'bg-info/10 text-info border-info/30 dark:text-info',
  client: 'bg-accent/10 text-accent border-accent/30 dark:text-accent',
};

function buildPlainTextBrief(report: RationaleReport, fmt: (n: number) => string): string {
  const lines: string[] = [];
  lines.push('STRATEGY RATIONALE — Borrowing Capacity Scenario');
  lines.push('━'.repeat(60));
  lines.push('');
  lines.push(report.headline);
  if (report.subHeadline) {
    lines.push('');
    lines.push(report.subHeadline);
  }
  lines.push('');
  lines.push('WHAT WE PROPOSE & WHY');
  lines.push('─'.repeat(60));
  if (report.bullets.length === 0) {
    lines.push('• Baseline only — no levers applied.');
  } else {
    report.bullets.forEach((b, i) => {
      const impact = b.capacityImpact === 0
        ? ''
        : ` (capacity ${b.capacityImpact > 0 ? '+' : ''}${fmt(b.capacityImpact)})`;
      lines.push(`${i + 1}. ${b.what}${impact}`);
      lines.push(`   ${b.why}`);
      if (b.cashflowNote) lines.push(`   Cash-flow: ${b.cashflowNote}`);
      lines.push('');
    });
  }
  lines.push('RECONCILIATION');
  lines.push('─'.repeat(60));
  lines.push(report.reconciliation);
  lines.push('');
  lines.push('RECOMMENDED EXECUTION SEQUENCE');
  lines.push('─'.repeat(60));
  if (report.sequence.length === 0) {
    lines.push('No execution steps required.');
  } else {
    report.sequence.forEach(s => {
      lines.push(`${s.step}. [${OWNER_LABEL[s.owner]}] ${s.action}`);
      if (s.detail) lines.push(`   ${s.detail}`);
    });
  }
  if (report.capitalFlow && report.capitalFlow.legs.length > 0) {
    const cf = report.capitalFlow;
    lines.push('');
    lines.push('CAPITAL FLOW (sources → sinks)');
    lines.push('─'.repeat(60));
    lines.push(`Pool: ${fmt(cf.totalAvailable)} available · ${fmt(cf.totalRouted)} routed · ${fmt(cf.remainder)} residual`);
    if (cf.overcommitted) lines.push('⚠ POOL OVERCOMMITTED — sinks were clamped.');
    cf.legs.forEach((leg) => {
      const svc = leg.monthlyServicingDelta;
      const svcLabel = svc !== 0
        ? ` · ${svc < 0 ? '−' : '+'}${fmt(Math.abs(svc))}/mo servicing`
        : '';
      const debt = leg.debtBalanceDelta;
      const debtLabel = debt !== 0
        ? ` · ${debt < 0 ? '−' : '+'}${fmt(Math.abs(debt))} debt`
        : '';
      lines.push(`• ${leg.sourceLabel} → ${leg.sinkLabel}: ${fmt(leg.amount)}${svcLabel}${debtLabel}`);
      if (leg.note) lines.push(`   ${leg.note}`);
    });
    lines.push(`Net servicing impact: ${cf.monthlyServicingDelta < 0 ? '−' : '+'}${fmt(Math.abs(cf.monthlyServicingDelta))}/mo · Net debt impact: ${cf.debtBalanceDelta < 0 ? '−' : '+'}${fmt(Math.abs(cf.debtBalanceDelta))}`);
  }
  lines.push('');
  lines.push('CAVEATS & ASSUMPTIONS');
  lines.push('─'.repeat(60));
  report.caveats.forEach(c => lines.push(`• ${c}`));
  lines.push('');
  lines.push(`Generated: ${new Date(report.generatedAt).toLocaleString('en-AU')}`);
  return lines.join('\n');
}

export function StrategyRationalePanel({ report, formatCurrency, pdfContext }: StrategyRationalePanelProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const briefText = useMemo(() => buildPlainTextBrief(report, formatCurrency), [report, formatCurrency]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(briefText);
      setCopied(true);
      toast.success('Strategy brief copied to clipboard');
      setTimeout(() => setCopied(false), 2200);
    } catch {
      toast.error('Could not copy — clipboard access denied');
    }
  };

  const handleDownloadPDF = async () => {
    if (!pdfContext) return;
    setDownloading(true);
    const toastId = 'rationale-pdf';
    toast.loading('Generating Strategy Rationale PDF…', { id: toastId });
    try {
      const { blob, fileName } = await generateStrategyRationalePDF(report, pdfContext);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Strategy Rationale PDF downloaded', { id: toastId });
    } catch (e) {
      console.error('Rationale PDF generation failed', e);
      toast.error('Could not generate PDF — see console', { id: toastId });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card className="border bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <ScrollText className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                Strategy Rationale
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  <Sparkles className="h-2.5 w-2.5 mr-1" />
                  Finance-ready
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Auto-generated explanation of what this scenario does, why each lever earns its place, and how the finance team should execute it.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" />
                  Copied
                </>
              ) : (
                <>
                  <Clipboard className="h-3.5 w-3.5 mr-1.5" />
                  Copy brief
                </>
              )}
            </Button>
            {pdfContext && (
              <>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={handleDownloadPDF}
                  disabled={downloading}
                >
                  {downloading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <FileDown className="h-3.5 w-3.5 mr-1.5" />
                      Download PDF
                    </>
                  )}
                </Button>
                <FlattenPdfIconButton
                  getPdfBlob={async () => (await generateStrategyRationalePDF(report, pdfContext!)).blob}
                  filename={`strategy-rationale.pdf`}
                  disabled={downloading}
                />
              </>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ── Headline ─────────────────────────────────────────────── */}
        <div className="rounded-md border bg-muted/40 p-3 space-y-1.5">
          <p className="text-sm font-medium leading-snug">{report.headline}</p>
          {report.subHeadline && (
            <p className="text-xs text-muted-foreground leading-relaxed">{report.subHeadline}</p>
          )}
        </div>

        {/* ── What & Why ──────────────────────────────────────────── */}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">What we propose & why</h4>
            {report.bullets.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {report.bullets.length} lever{report.bullets.length === 1 ? '' : 's'}
              </Badge>
            )}
          </div>

          {report.bullets.length === 0 ? (
            <p className="text-xs text-muted-foreground italic pl-6">
              No levers active — toggle a lever above to see its rationale here.
            </p>
          ) : (
            <ul className="space-y-2">
              {report.bullets.map(b => {
                const cls = SEVERITY_CLASSES[b.severity];
                return (
                  <li
                    key={b.id}
                    className={`border-l-2 pl-3 py-1.5 ${cls.ring}`}
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <p className="text-sm font-medium leading-snug">{b.what}</p>
                      {b.capacityImpact !== 0 && (
                        <Badge variant="outline" className={`text-[10px] ${cls.badge}`}>
                          {b.capacityImpact > 0 ? '+' : ''}{formatCurrency(b.capacityImpact)} capacity
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{b.why}</p>
                    {b.cashflowNote && (
                      <p className={`text-[11px] mt-1 font-medium ${cls.text}`}>
                        Cash-flow effect: {b.cashflowNote}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Reconciliation ──────────────────────────────────────── */}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">How the math reconciles</h4>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed pl-6">
            {report.reconciliation}
          </p>
        </section>

        {/* ── K5: Capital Flow ───────────────────────────────────── */}
        {report.capitalFlow && report.capitalFlow.legs.length > 0 && (
          <>
            <Separator />
            <section className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Wallet className="h-4 w-4 text-primary" />
                <h4 className="text-sm font-semibold">Capital flow (sources → sinks)</h4>
                {report.capitalFlow.overcommitted && (
                  <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">
                    Pool overcommitted
                  </Badge>
                )}
              </div>
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <div>Available <span className="block text-sm font-semibold text-foreground normal-case tracking-normal">{formatCurrency(report.capitalFlow.totalAvailable)}</span></div>
                  <div>Routed <span className="block text-sm font-semibold text-foreground normal-case tracking-normal">{formatCurrency(report.capitalFlow.totalRouted)}</span></div>
                  <div>Residual <span className="block text-sm font-semibold text-foreground normal-case tracking-normal">{formatCurrency(report.capitalFlow.remainder)}</span></div>
                </div>
                <Separator />
                <ul className="space-y-2">
                  {report.capitalFlow.legs.map((leg, i) => {
                    const svc = leg.monthlyServicingDelta;
                    const debt = leg.debtBalanceDelta;
                    const isUnallocated = leg.sinkType === 'unallocated';
                    return (
                      <li key={i} className={`border-l-2 pl-3 py-1 ${isUnallocated ? 'border-l-muted-foreground/40' : 'border-l-primary'}`}>
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <p className="text-xs font-medium leading-snug">
                            <span className="text-muted-foreground">{leg.sourceLabel}</span>
                            <ArrowRight className="inline h-3 w-3 mx-1 text-muted-foreground" />
                            <span>{leg.sinkLabel}</span>
                          </p>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px]">
                              {formatCurrency(leg.amount)}
                            </Badge>
                            {svc !== 0 && (
                              <Badge variant="outline" className={`text-[10px] ${svc < 0 ? 'bg-success/10 text-success border-success/30 dark:text-success' : 'bg-destructive/10 text-destructive border-destructive/30'}`}>
                                {svc < 0 ? '−' : '+'}{formatCurrency(Math.abs(svc))}/mo
                              </Badge>
                            )}
                            {debt !== 0 && (
                              <Badge variant="outline" className="text-[10px]">
                                {debt < 0 ? '−' : '+'}{formatCurrency(Math.abs(debt))} debt
                              </Badge>
                            )}
                          </div>
                        </div>
                        {leg.note && (
                          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{leg.note}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <Separator />
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Net capital impact</span>
                  <span className="font-medium text-foreground">
                    {report.capitalFlow.monthlyServicingDelta < 0 ? '−' : '+'}{formatCurrency(Math.abs(report.capitalFlow.monthlyServicingDelta))}/mo · {report.capitalFlow.debtBalanceDelta < 0 ? '−' : '+'}{formatCurrency(Math.abs(report.capitalFlow.debtBalanceDelta))} debt
                  </span>
                </div>
              </div>
            </section>
          </>
        )}

        <Separator />

        {/* ── Sequence ────────────────────────────────────────────── */}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">Recommended execution sequence</h4>
          </div>

          {report.sequence.length === 0 ? (
            <p className="text-xs text-muted-foreground italic pl-6">
              No execution steps — baseline scenario.
            </p>
          ) : (
            <ol className="space-y-2">
              {report.sequence.map(s => (
                <li key={s.step} className="flex gap-3 items-start">
                  <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary border border-primary/30 flex items-center justify-center text-xs font-semibold">
                    {s.step}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <p className="text-sm font-medium leading-snug">{s.action}</p>
                      <Badge variant="outline" className={`text-[10px] ${OWNER_BADGE[s.owner]}`}>
                        {OWNER_LABEL[s.owner]}
                      </Badge>
                    </div>
                    {s.detail && (
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.detail}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <Separator />

        {/* ── Caveats ─────────────────────────────────────────────── */}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-brand-600" />
            <h4 className="text-sm font-semibold">Caveats & assumptions</h4>
          </div>
          <ul className="space-y-1.5 pl-6">
            {report.caveats.map((c, i) => (
              <li key={i} className="text-xs text-muted-foreground leading-relaxed flex gap-2">
                <AlertTriangle className="h-3 w-3 text-brand-600 mt-0.5 shrink-0" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
