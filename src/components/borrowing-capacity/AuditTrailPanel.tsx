import { useState } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ChevronDown,
  Search,
  ArrowDown,
  ArrowUp,
  Minus,
  DollarSign,
  Receipt,
  Landmark,
  Home,
  Calculator,
  Shield,
  FileText,
  Settings,
} from 'lucide-react';
import type { AuditTrail, AuditEntry, AuditCategory } from '@/utils/auditEngine';
import { auditDelta, auditMeasures } from '@/lib/reports/borrowingCapacity/audit.pure';
import { aud, formatMeasure } from '@/lib/reportDesign/measure.pure';
import type { ExplanationReport, ExplanationStep } from '@/utils/explanationEngine';

// ============================================
// AUDIT TRAIL PANEL
// ============================================

interface AuditTrailPanelProps {
  auditTrail?: AuditTrail;
  explanation?: ExplanationReport;
}

const categoryConfig: Record<AuditCategory, { label: string; icon: typeof DollarSign; color: string }> = {
  income: { label: 'Income', icon: DollarSign, color: 'text-success' },
  expense: { label: 'Expenses', icon: Receipt, color: 'text-warning' },
  liability: { label: 'Liabilities', icon: Landmark, color: 'text-destructive' },
  property: { label: 'Properties', icon: Home, color: 'text-primary' },
  tax: { label: 'Tax', icon: Calculator, color: 'text-muted-foreground' },
  policy: { label: 'Policy', icon: Settings, color: 'text-primary' },
  constraint: { label: 'Constraints', icon: Shield, color: 'text-warning' },
};

/** The summary totals really are dollars — they are sums of AUD adjustments. */
function formatAuditCurrency(value: number): string {
  return formatMeasure(aud(value));
}

/**
 * An audit value, in the unit the entry actually carries.
 *
 * This put every value through one currency formatter, so the panel told a
 * client their assessment rate went from **$6 to $9** when it went from 6.15%
 * to 8.65% — `policy/override_applied` is declared `percent` on both sides in
 * `audit.pure.ts`, and a credit-card row's raw value is a balance while its
 * assessed value is a monthly repayment.
 *
 * `auditMeasures` already knows all of that; it just was not being asked.
 */
function formatAuditValue(entry: AuditEntry, side: 'raw' | 'assessed'): string {
  const measures = auditMeasures(entry as never);
  return formatMeasure(side === 'raw' ? measures.raw : measures.assessed);
}

/**
 * The size of the movement, which only exists when both sides share a unit.
 *
 * `auditDelta` returns null for the liability rows — subtracting a monthly
 * repayment from a balance is not a number — and the badge then shows the
 * direction without a figure rather than a figure that means nothing.
 */
function formatAuditDelta(entry: AuditEntry): string | null {
  const delta = auditDelta(entry as never);
  return delta ? formatMeasure(delta) : null;
}

function ImpactBadge({ impact, amount }: { impact: string; amount: string | null }) {
  if (impact === 'neutral') return <Badge variant="secondary" className="text-xs"><Minus className="h-3 w-3 mr-0.5" />Neutral</Badge>;
  // No shared unit, no figure — see `formatAuditDelta`.
  const shown = amount ? amount.replace(/^[-+]/, '') : '';
  if (impact === 'increase') return <Badge className="bg-success/20 text-success border-success/30 text-xs"><ArrowUp className="h-3 w-3 mr-0.5" />{shown ? `+${shown}` : 'Increase'}</Badge>;
  return <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-xs"><ArrowDown className="h-3 w-3 mr-0.5" />{shown || 'Decrease'}</Badge>;
}

function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  const config = categoryConfig[entry.category];
  const Icon = config.icon;

  return (
    <div className="flex items-start justify-between py-2 px-3 rounded-lg hover:bg-secondary/30 transition-colors text-sm">
      <div className="flex items-start gap-2 flex-1 min-w-0">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.color}`} />
        <div className="min-w-0">
          <p className="font-medium text-foreground truncate">{entry.label}</p>
          <p className="text-xs text-muted-foreground">{entry.rule}</p>
          {entry.note && <p className="text-xs text-muted-foreground/70 italic mt-0.5">{entry.note}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-2">
        <div className="text-right text-xs">
          <p className="text-muted-foreground">{formatAuditValue(entry, 'raw')}</p>
          <p className="font-medium text-foreground">→ {formatAuditValue(entry, 'assessed')}</p>
        </div>
        <ImpactBadge impact={entry.impact} amount={formatAuditDelta(entry)} />
      </div>
    </div>
  );
}

function ExplanationStepCard({ step }: { step: ExplanationStep }) {
  const iconMap: Record<string, typeof DollarSign> = {
    income: DollarSign, expense: Receipt, liability: Landmark, tax: Calculator,
    capacity: DollarSign, dti: Shield, stress: Shield, band: Shield,
    policy: Settings, property: Home,
  };
  const Icon = iconMap[step.icon] || FileText;

  return (
    <div className="p-3 rounded-lg border bg-card">
      <div className="flex items-start gap-2">
        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 shrink-0">
          <span className="text-xs font-bold text-primary">{step.step}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Icon className="h-4 w-4 text-primary shrink-0" />
            <p className="font-medium text-sm">{step.title}</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{step.narrative}</p>
          {step.figures.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {step.figures.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-xs bg-secondary/50 rounded px-2 py-0.5">
                  <span className="text-muted-foreground">{f.label}:</span>
                  <span className="font-medium">{f.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AuditTrailPanel({ auditTrail, explanation }: AuditTrailPanelProps) {
  const [showAudit, setShowAudit] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<AuditCategory | 'all'>('all');

  if (!auditTrail && !explanation) return null;

  const filteredEntries = auditTrail
    ? selectedCategory === 'all'
      ? auditTrail.entries
      : auditTrail.entries.filter(e => e.category === selectedCategory)
    : [];

  const categories: (AuditCategory | 'all')[] = ['all', 'income', 'expense', 'liability', 'property', 'tax', 'policy', 'constraint'];

  return (
    <div className="space-y-3">
      {/* Explanation Section */}
      {explanation && (
        <Collapsible open={showExplanation} onOpenChange={setShowExplanation}>
          <CollapsibleTrigger className="flex items-center justify-between w-full text-left p-3 rounded-lg bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-colors">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">How Was This Calculated?</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{explanation.steps.length} steps</Badge>
              <ChevronDown className={`h-4 w-4 transition-transform ${showExplanation ? 'rotate-180' : ''}`} />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            {/* Executive Summary */}
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/15 text-xs text-muted-foreground leading-relaxed">
              <p className="font-medium text-foreground text-sm mb-1">{explanation.headline}</p>
              <p>{explanation.executiveSummary}</p>
            </div>

            {/* Steps */}
            <div className="space-y-2">
              {explanation.steps.map((step) => (
                <ExplanationStepCard key={step.step} step={step} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Audit Trail Section */}
      {auditTrail && auditTrail.entries.length > 0 && (
        <Collapsible open={showAudit} onOpenChange={setShowAudit}>
          <CollapsibleTrigger className="flex items-center justify-between w-full text-left p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Audit Trail</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{auditTrail.summary.totalTransformations} transformations</Badge>
              {auditTrail.summary.hasOverrides && <Badge className="bg-warning/20 text-warning border-warning/30 text-xs">Overrides</Badge>}
              <ChevronDown className={`h-4 w-4 transition-transform ${showAudit ? 'rotate-180' : ''}`} />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <div className="text-center p-2 rounded bg-success/10 border border-success/20">
                <p className="text-xs text-muted-foreground">Income Shading</p>
                <p className="text-sm font-bold text-success">{formatAuditCurrency(auditTrail.summary.totalIncomeShading)}</p>
              </div>
              <div className="text-center p-2 rounded bg-warning/10 border border-warning/20">
                <p className="text-xs text-muted-foreground">Expense Adj.</p>
                <p className="text-sm font-bold text-warning">{formatAuditCurrency(auditTrail.summary.totalExpenseAdjustments)}</p>
              </div>
              <div className="text-center p-2 rounded bg-destructive/10 border border-destructive/20">
                <p className="text-xs text-muted-foreground">Liability Adj.</p>
                <p className="text-sm font-bold text-destructive">{formatAuditCurrency(auditTrail.summary.totalLiabilityAdjustments)}</p>
              </div>
              <div className="text-center p-2 rounded bg-muted/50 border border-border">
                <p className="text-xs text-muted-foreground">Tax Impact</p>
                <p className="text-sm font-bold text-muted-foreground">{formatAuditCurrency(auditTrail.summary.totalTaxImpact)}</p>
              </div>
            </div>

            {/* Category Filter */}
            <div className="flex flex-wrap gap-1 mb-3">
              {categories.map(cat => {
                const isActive = selectedCategory === cat;
                const count = cat === 'all' ? auditTrail.entries.length : auditTrail.summary.byCategory[cat] || 0;
                if (cat !== 'all' && count === 0) return null;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                      isActive ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary/50 text-muted-foreground border-border hover:bg-secondary'
                    }`}
                  >
                    {cat === 'all' ? 'All' : categoryConfig[cat].label} ({count})
                  </button>
                );
              })}
            </div>

            <Separator className="mb-2" />

            {/* Entries */}
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {filteredEntries.map((entry) => (
                <AuditEntryRow key={entry.seq} entry={entry} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
