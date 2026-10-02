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
  ChevronDown,
  Bot,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChooseTemplateButton } from '@/components/reports/ChooseTemplateButton';
import { rationaleDownloadName, requestStrategyRationale } from '@/lib/reports/borrowingCapacity/deliverStrategyRationale';
import {
  ADVISOR_OPTIONS_NOTE,
  advisorOptionLine,
  composeAdvisorSection,
  RECONCILE_TITLE,
  rationaleReadingNote,
  type RationaleAdvisorInput,
  type RationaleAdvisorSection,
} from '@/lib/reports/borrowingCapacity/strategyRationale.pure';
import type { RationaleReport, RationaleSeverity, RationaleCapitalFlowEntry } from '@/utils/strategyRationaleEngine';
import { generateStrategyRationalePDF, type RationalePDFContext } from './StrategyRationalePDF';

interface StrategyRationalePanelProps {
  report: RationaleReport;
  /** Same currency formatter the parent uses. */
  formatCurrency: (n: number) => string;
  /** Context required to render a finance-ready PDF brief. When omitted the
   *  PDF download button is hidden (e.g. preview surfaces without client info). */
  pdfContext?: RationalePDFContext;
  /**
   * The client the brief is about. With it, "Export PDF" is typeset by the
   * Borrowing Capacity route in the template chosen for Borrowing Capacity
   * (BORROWING_CAPACITY.md §17); without it, the jsPDF brief is the only one.
   */
  clientId?: string;
  /**
   * The Strategy Advisor's reasoning for the card whose levers are live. It is
   * shown here, copied with the brief and printed in both PDFs; absent for a
   * scenario built by hand, and the panel is then exactly as it was.
   */
  advisor?: RationaleAdvisorInput | null;
}

/** Hand a blob to the browser as a saved file. */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
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

const ADVISOR_RISK_BADGE: Record<'low' | 'medium' | 'high', string> = {
  low: 'bg-success/10 text-success border-success/30',
  medium: 'bg-brand-500/10 text-brand-700 border-brand-500/30 dark:text-brand-400',
  high: 'bg-destructive/10 text-destructive border-destructive/30',
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

function buildPlainTextBrief(
  report: RationaleReport,
  fmt: (n: number) => string,
  advisor: RationaleAdvisorSection | null,
  readingNote: string | null = null,
): string {
  const lines: string[] = [];
  lines.push('STRATEGY RATIONALE — Borrowing Capacity Scenario');
  lines.push('━'.repeat(60));
  lines.push('');
  lines.push(report.headline);
  if (report.subHeadline) {
    lines.push('');
    lines.push(report.subHeadline);
  }
  if (readingNote) {
    lines.push('');
    lines.push(readingNote);
  }
  lines.push('');
  if (advisor) {
    lines.push(advisor.title.toUpperCase());
    lines.push('─'.repeat(60));
    lines.push(advisor.scenarioLine);
    lines.push('');
    advisor.paragraphs.forEach((para) => {
      lines.push(para);
      lines.push('');
    });
    if (advisor.riskLine) {
      lines.push(advisor.riskLine);
      lines.push('');
    }
    if (advisor.evidence.length) {
      lines.push(advisor.evidenceTitle);
      advisor.evidence.forEach((e) => lines.push(`• ${e}`));
      lines.push('');
    }
    if (advisor.rejected.length) {
      lines.push(advisor.rejectedTitle);
      advisor.rejected.forEach((r) => lines.push(`• ${r}`));
      lines.push('');
    }
    if (advisor.cautions.length) {
      lines.push(advisor.cautionsTitle);
      advisor.cautions.forEach((c) => lines.push(`• ${c}`));
      lines.push('');
    }
    if (advisor.options.length) {
      lines.push(advisor.optionsTitle);
      advisor.options.forEach((o) => lines.push(`• ${advisorOptionLine(o)}`));
      lines.push(ADVISOR_OPTIONS_NOTE);
      lines.push('');
    }
    advisor.notes.forEach((n) => lines.push(n));
    lines.push('');
  }
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
      if (b.cashflowNote) lines.push(`   Cash flow: ${b.cashflowNote}`);
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

export function StrategyRationalePanel({ report, formatCurrency, pdfContext, clientId, advisor }: StrategyRationalePanelProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const advisorSection = useMemo(() => composeAdvisorSection(advisor), [advisor]);
  const readingNote = useMemo(() => (pdfContext ? rationaleReadingNote(pdfContext) : null), [pdfContext]);
  const briefText = useMemo(
    () => buildPlainTextBrief(report, formatCurrency, advisorSection, readingNote),
    [report, formatCurrency, advisorSection, readingNote],
  );

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

  /**
   * The brief as a file. `typeset` asks the route for it in the chosen
   * template, falling back to the jsPDF brief only where the route cannot draw
   * it; `legacy` is a person choosing the layout this brief has always had.
   * The words are the same either way (`strategyRationale.pure.ts`).
   */
  const produceBrief = async (which: 'typeset' | 'legacy') => {
    const context = { ...pdfContext!, advisor: advisor ?? null };
    const legacy = () => generateStrategyRationalePDF(report, context);
    if (which === 'legacy' || !clientId) return { ...(await legacy()), source: 'legacy' as const };
    return requestStrategyRationale(
      { clientId, clientName: pdfContext!.clientName, report, context },
      legacy,
    );
  };

  const handleDownloadPDF = async (which: 'typeset' | 'legacy' = 'typeset') => {
    if (!pdfContext || downloading) return;
    setDownloading(true);
    const toastId = 'rationale-pdf';
    toast.loading('Generating Strategy Rationale PDF…', { id: toastId });
    try {
      const { blob, fileName, source } = await produceBrief(which);
      saveBlob(blob, fileName);
      toast.success(
        which === 'typeset' && clientId && source === 'legacy'
          ? 'Strategy Rationale PDF downloaded in the legacy layout — the typeset brief is not available on this deployment yet'
          : 'Strategy Rationale PDF downloaded',
        { id: toastId },
      );
    } catch (e) {
      console.error('Rationale PDF generation failed', e);
      toast.error(e instanceof Error ? e.message : 'Could not generate PDF', { id: toastId });
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
                {clientId && (
                  <ChooseTemplateButton
                    reportType="borrowing_capacity"
                    formatLabel="Borrowing Capacity"
                    note="The Strategy Rationale uses the Borrowing Capacity's template."
                    disabled={downloading}
                  />
                )}
                <div className="inline-flex items-stretch">
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => handleDownloadPDF('typeset')}
                    disabled={downloading}
                    className={clientId ? 'rounded-r-none' : undefined}
                  >
                    {downloading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      <>
                        <FileDown className="h-3.5 w-3.5 mr-1.5" />
                        Export PDF
                      </>
                    )}
                  </Button>
                  {clientId && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          disabled={downloading}
                          className="rounded-l-none border-l border-primary-foreground/20 px-1.5"
                          aria-label="More download options"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        <DropdownMenuItem onClick={() => handleDownloadPDF('legacy')} className="cursor-pointer">
                          <FileDown className="mr-2 h-4 w-4 text-muted-foreground" />
                          <div className="flex flex-col">
                            <span>Download (legacy layout)</span>
                            <span className="text-xs text-muted-foreground">The layout this brief has always used</span>
                          </div>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <FlattenPdfIconButton
                  getPdfBlob={async () => (await produceBrief('typeset')).blob}
                  filename={rationaleDownloadName(pdfContext.clientName)}
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
          {readingNote && (
            <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-l-primary pl-2">
              {readingNote}
            </p>
          )}
        </div>

        {/* ── Strategy Advisor: why this scenario ──────────────────── */}
        {advisorSection && (
          <section className="space-y-2" aria-label={advisorSection.title}>
            <div className="flex items-center gap-2 flex-wrap">
              <Bot className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-semibold">{advisorSection.title}</h4>
              {advisorSection.risk && (
                <Badge variant="outline" className={`text-[10px] ${ADVISOR_RISK_BADGE[advisorSection.risk]}`}>
                  {advisorSection.riskLine}
                </Badge>
              )}
            </div>
            <div className="rounded-md border border-l-2 border-l-primary bg-muted/30 p-3 space-y-2">
              <p className="text-xs font-medium">{advisorSection.scenarioLine}</p>
              {advisorSection.paragraphs.map((para, i) => (
                <p key={i} className="text-xs text-muted-foreground leading-relaxed">{para}</p>
              ))}
              {advisorSection.evidence.length > 0 && (
                <div className="pt-1">
                  <p className="text-[11px] font-semibold">{advisorSection.evidenceTitle}</p>
                  <ul className="mt-1 space-y-1 list-disc pl-4">
                    {advisorSection.evidence.map((e, i) => (
                      <li key={i} className="text-[11px] text-muted-foreground leading-relaxed">{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {advisorSection.rejected.length > 0 && (
                <div className="pt-1">
                  <p className="text-[11px] font-semibold">{advisorSection.rejectedTitle}</p>
                  <ul className="mt-1 space-y-1 list-disc pl-4">
                    {advisorSection.rejected.map((r, i) => (
                      <li key={i} className="text-[11px] text-muted-foreground leading-relaxed">{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {advisorSection.cautions.length > 0 && (
                <div className="pt-1">
                  <p className="text-[11px] font-semibold">{advisorSection.cautionsTitle}</p>
                  <ul className="mt-1 space-y-1 list-disc pl-4">
                    {advisorSection.cautions.map((c, i) => (
                      <li key={i} className="text-[11px] text-muted-foreground leading-relaxed">{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {advisorSection.options.length > 0 && (
                <div className="pt-1">
                  <p className="text-[11px] font-semibold">{advisorSection.optionsTitle}</p>
                  <div className="mt-1 overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th scope="col" className="text-left font-medium py-1 pr-2">Option</th>
                          <th scope="col" className="text-right font-medium py-1 px-2">Capacity</th>
                          <th scope="col" className="text-right font-medium py-1 px-2">Purchase power</th>
                          <th scope="col" className="text-right font-medium py-1 px-2">Target</th>
                          <th scope="col" className="text-right font-medium py-1 pl-2">Risk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {advisorSection.options.map((o, i) => (
                          <tr key={i} className={`border-t ${o.applied ? 'font-semibold' : 'text-muted-foreground'}`}>
                            <td className="py-1 pr-2">
                              {o.name}
                              {o.applied && <span className="ml-1 font-normal text-primary">(applied)</span>}
                            </td>
                            <td className="text-right py-1 px-2 tabular-nums">{o.capacity}</td>
                            <td className="text-right py-1 px-2 tabular-nums">{o.purchasePower}</td>
                            <td className="text-right py-1 px-2">{o.target}</td>
                            <td className="text-right py-1 pl-2">{o.risk}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-1 text-[10px] italic text-muted-foreground">{ADVISOR_OPTIONS_NOTE}</p>
                </div>
              )}
              {advisorSection.notes.map((n, i) => (
                <p key={i} className="text-[10px] italic text-muted-foreground leading-relaxed">{n}</p>
              ))}
            </div>
          </section>
        )}

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
            <h4 className="text-sm font-semibold">{RECONCILE_TITLE}</h4>
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
