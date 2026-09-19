import { useState, type ReactNode } from 'react';
import { CheckCircle2, FileText, FileWarning, Sparkles, UploadCloud, Save, Download, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCommercialDealState } from '@/utils/commercial/commercialDealState';
import { buildCommercialIndustrialReportPayload } from '@/utils/commercial/reportPayloadBuilder';
import { buildScenarioReportPayload } from '@/utils/commercial/scenarioReportBuilder';
import { useCalculatorPrefill } from '@/contexts/CalculatorPrefillContext';

const fmt = (n?: number) => n == null ? 'Pending' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);
const pct = (n?: number) => n == null ? 'Pending' : `${(n * 100).toFixed(1)}%`;
const title = (v?: string) => (v || 'Pending').replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
const badgeVariant = (r?: string) => !r ? 'outline' : (r === 'green' || r === 'supportable' ? 'default' : r === 'amber' || r === 'supportableSubjectToVerification' ? 'secondary' : 'destructive');
const actionBase = 'min-h-10 justify-start gap-2 rounded-xl text-left shadow-sm transition-all disabled:cursor-not-allowed disabled:border-border/60 disabled:bg-muted/40 disabled:text-muted-foreground disabled:opacity-100';
const primaryAction = `${actionBase} dashboard-luxury-primary-cta hover:shadow-md`;
const secondaryAction = `${actionBase} dashboard-luxury-action`;
const reviewAction = `${actionBase} border-brand-500/40 bg-brand-500/10 text-brand-900 hover:bg-brand-500/15 dark:text-brand-100`;
const clientAction = `${actionBase} dashboard-luxury-action`;
const actionIcon = 'h-4 w-4 shrink-0';

function Row({ label, value }: { label: string; value: string | number | undefined }) {
  const displayValue = typeof value === 'number' ? fmt(value) : value || 'Pending';
  const isPending = displayValue === 'Pending';

  return (
    <div className="group flex min-h-[3.25rem] justify-between gap-4 rounded-xl border border-border/70 bg-background/70 px-3.5 py-2.5 text-sm shadow-sm transition-colors hover:border-primary/20 hover:bg-muted/20">
      <span className="max-w-[55%] text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`text-right text-sm font-semibold leading-snug ${isPending ? 'rounded-full border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 text-brand-700 dark:text-brand-200' : 'text-foreground'}`}>{displayValue}</span>
    </div>
  );
}

function Section({ title: heading, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="overflow-hidden border-border/70 bg-card/95 shadow-sm">
      <CardHeader className="border-b border-border/60 bg-muted/20 pb-3">
        <CardTitle className="text-base font-semibold tracking-tight">{heading}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5 p-4">{children}</CardContent>
    </Card>
  );
}

function downloadFile(name: string, content: string, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CommercialIndustrialOverviewCard() {
  const profile = useCommercialDealState(s => s.profile);
  const updateGlobal = useCommercialDealState(s => s.updateGlobal);
  const borrowing = profile.borrowingOutputs;
  const reportPayload = buildCommercialIndustrialReportPayload(profile);
  const isIndustrial = profile.dealProfile.assetCategory === 'industrial';
  const docs = reportPayload.sections.find(s => s.title === 'Required Documents')?.data as any[] | undefined;
  const aiFields = Object.values(profile.aiEstimateMetadata).filter(e => e.confidenceTag === 'AI Estimate');
  const unknowns = Object.values(profile.assumptions).filter(a => a.confidenceTag === 'Unknown' || a.confidenceTag === 'Specialist Review Required');
  const tenYear = profile.tenYearCashFlowOutputs;
  const clientScenario = profile.clientScenarioOutputs;
  const hasIncompletePropertyInfo = !profile.propertyValuation.purchasePrice || !profile.propertyValuation.estimatedMarketValue || unknowns.length > 0;

  const { prefill, property, pushBack } = useCalculatorPrefill();
  const [showMissing, setShowMissing] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [busy, setBusy] = useState<null | 'report' | 'export' | 'save' | 'push'>(null);

  const fileSlug = (prefill?.address || profile.dealProfile.assetCategory || 'commercial-deal').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60);

  const handleGenerateReport = () => {
    setBusy('report');
    try {
      downloadFile(`${fileSlug}-client-report.json`, JSON.stringify(reportPayload, null, 2));
      toast.success(`Client report payload generated (${reportPayload.sections.length} sections).`);
    } catch (e: any) {
      toast.error(`Report generation failed: ${e.message ?? e}`);
    } finally { setBusy(null); }
  };

  const handleExportSummary = () => {
    setBusy('export');
    try {
      const summary = {
        generatedAt: reportPayload.generatedAt,
        transactionSummary: reportPayload.transactionSummary,
        borrowingOutcome: reportPayload.borrowingOutcome,
        purchaseAbility: reportPayload.purchaseAbility,
        assumptions: reportPayload.assumptions,
      };
      downloadFile(`${fileSlug}-summary.json`, JSON.stringify(summary, null, 2));
      toast.success('Summary exported.');
    } finally { setBusy(null); }
  };

  const handleSaveBack = async () => {
    if (!property) { toast.error('Select a property first to save back.'); return; }
    setBusy('save');
    try {
      const patch: Record<string, unknown> = {};
      const purchase = profile.propertyValuation.purchasePrice;
      const valuation = borrowing?.propertyValueUsedForLvr ?? profile.propertyValuation.estimatedMarketValue;
      if (purchase) patch.purchase_price = purchase;
      if (valuation) {
        // commercial uses `valuation`, industrial uses `current_valuation`
        if (prefill?.domain === 'industrial') patch.current_valuation = valuation;
        else patch.valuation = valuation;
      }
      if (Object.keys(patch).length === 0) {
        toast.message('No calculator-derived values to save back yet.');
      } else {
        await pushBack(patch);
      }
    } finally { setBusy(null); }
  };


  const handleSaveScenarioStatus = (status: 'Draft' | 'Recommended' | 'Committed') => {
    if (!clientScenario) { toast.error('Run or select a client scenario before saving.'); return; }
    if (status === 'Committed' && !confirm('Commit this scenario to the client profile current position? Draft and Recommended scenarios will not overwrite current position.')) return;
    const nextScenario = {
      ...clientScenario,
      status,
      auditLog: [...clientScenario.auditLog, {
        timestamp: new Date().toISOString(),
        user: 'Calculator user',
        action: status === 'Committed' ? 'scenario_commit' : 'scenario_status_change',
        field: 'status',
        previousValue: clientScenario.status,
        newValue: status,
        source: 'Overview tab action',
        scenarioId: clientScenario.scenarioId,
      }],
    };
    updateGlobal('clientScenarioOutputs', nextScenario as any);
    toast.success(status === 'Committed' ? 'Scenario committed with audit trail.' : `Scenario saved as ${status}.`);
  };

  const handleExportScenarioReport = () => {
    if (!clientScenario) { toast.error('No client scenario is available to export.'); return; }
    downloadFile(`${fileSlug}-scenario-report.json`, JSON.stringify(buildScenarioReportPayload(clientScenario), null, 2));
    toast.success('Scenario report exported.');
  };

  const handleClientFacingSummary = () => {
    if (!clientScenario) { toast.error('No client scenario is available to summarise.'); return; }
    const report = buildScenarioReportPayload(clientScenario) as any;
    downloadFile(`${fileSlug}-client-facing-scenario-summary.json`, JSON.stringify({ generatedAt: report.generatedAt, scenario: report.scenario, summary: clientScenario.reportSummary, recommendedNextSteps: report.narrative.recommendedNextSteps, requiredDocuments: clientScenario.requiredDocuments, warnings: clientScenario.warnings }, null, 2));
    toast.success('Client-facing summary generated.');
  };

  const handlePushToPortal = () => {
    setBusy('push');
    try {
      // Stash payload so a future portal-sync surface can pick it up; until the
      // shared-portal edge function ships, give the operator a clear receipt.
      const key = `commercial-portal-pending:${prefill?.propertyId ?? 'unlinked'}`;
      sessionStorage.setItem(key, JSON.stringify(reportPayload));
      toast.success('Report queued for client portal sync.', {
        description: prefill?.propertyId ? `Linked to property ${prefill.address}` : 'No property linked — queued under "unlinked".',
      });
    } finally { setBusy(null); }
  };

  const ReportActions = (
    <Card className="overflow-hidden border-primary/35 bg-gradient-to-br from-card via-card to-primary/5 shadow-md">
      <CardHeader className="border-b border-border/60 bg-muted/20 pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Report Actions</CardTitle>
            <CardDescription>Controlled workflow for generating, reviewing and distributing the commercial / industrial deal report.</CardDescription>
          </div>
          <Badge variant="outline" className="w-fit bg-background/70">Operator controlled</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-2xl border border-primary/25 bg-primary/5 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">Client-ready output</p>
            <Button size="sm" className={primaryAction} onClick={handleGenerateReport} disabled={busy === 'report'}>
              {busy === 'report' ? <Loader2 className={`${actionIcon} animate-spin`} /> : <FileText className={actionIcon} />}
              Generate Client Report
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button size="sm" variant="outline" className={reviewAction} onClick={() => setShowMissing(true)}>
              <FileWarning className={actionIcon} /> Review Missing Data ({unknowns.length})
            </Button>
            <Button size="sm" variant="outline" className={reviewAction} onClick={() => setShowAi(true)}>
              <Sparkles className={actionIcon} /> Review AI Estimates ({aiFields.length})
            </Button>
            <Button size="sm" variant="outline" className={secondaryAction} onClick={handleSaveBack} disabled={!property || busy === 'save'}>
              {busy === 'save' ? <Loader2 className={`${actionIcon} animate-spin`} /> : <Save className={actionIcon} />}
              Save Back to Property
            </Button>
            <Button size="sm" variant="outline" className={secondaryAction} onClick={handleExportSummary} disabled={busy === 'export'}>
              {busy === 'export' ? <Loader2 className={`${actionIcon} animate-spin`} /> : <Download className={actionIcon} />} Export Summary
            </Button>
            <Button size="sm" variant="outline" className={`${clientAction} sm:col-span-2`} onClick={handlePushToPortal} disabled={busy === 'push'}>
              {busy === 'push' ? <Loader2 className={`${actionIcon} animate-spin`} /> : <UploadCloud className={actionIcon} />} Push to Client Portal
            </Button>
          </div>
        </div>
        <Separator />
        <p className="text-xs text-muted-foreground">
          Report payload ready with {reportPayload.sections.length} sections, including verified values, manual estimates, AI estimates, unknown assumptions and specialist review items.
          {!property && ' Link a property via ?propertyId= to enable Save Back.'}
        </p>
      </CardContent>
    </Card>
  );

  return <div className="space-y-5">
    {hasIncompletePropertyInfo && (
      <Card className="border-brand-500/40 bg-gradient-to-r from-brand-500/15 via-brand-500/10 to-card shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold text-brand-900 dark:text-brand-100">Property-level information is incomplete.</div>
            <p className="text-xs text-brand-800/80 dark:text-brand-100/80">Add or import property details before relying on this calculation.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className={reviewAction} onClick={() => setShowMissing(true)}>
              Review Missing Data ({unknowns.length})
            </Button>
            <Button size="sm" variant="outline" className={reviewAction} onClick={() => setShowAi(true)}>
              Review AI Estimates ({aiFields.length})
            </Button>
          </div>
        </CardContent>
      </Card>
    )}

    <Card className="overflow-hidden border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card shadow-md">
      <CardHeader className="border-b border-primary/10 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><CardTitle className="flex items-center gap-2 text-xl"><FileText className="h-5 w-5 text-primary" /> Commercial / Industrial Assessment Overview</CardTitle><CardDescription className="mt-1 max-w-3xl">Executive deal summary generated from the shared global deal state. Deterministic calculator outputs remain the source of truth for client-ready report decisions.</CardDescription></div>
          <div className="flex flex-wrap gap-2"><Badge variant={badgeVariant(borrowing?.creditAssessmentStatus) as any}>{borrowing?.creditAssessmentStatusLabel ?? 'Credit status pending'}</Badge><Badge variant={badgeVariant(borrowing?.overallStatus) as any}>{borrowing?.purchaseAbilityStatusLabel ?? 'Purchase ability pending'}</Badge></div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <Row label="Asset domain" value={title(profile.dealProfile.assetCategory)} />
        <Row label="Asset subtype" value={profile.dealProfile.assetSubtype} />
        <Row label="Acquisition purpose" value={title(profile.dealProfile.acquisitionPurpose)} />
        <Row label="Purchase price" value={profile.propertyValuation.purchasePrice} />
        <Row label="Property value used" value={borrowing?.propertyValueUsedForLvr ?? profile.propertyValuation.estimatedMarketValue} />
        <Row label="Maximum risk-adjusted loan" value={borrowing?.finalRiskAdjustedLoan} />
        <Row label="Proposed loan" value={borrowing?.proposedLoan ? fmt(borrowing.proposedLoan) : 'No proposed loan entered'} />
        <Row label="Binding constraint" value={title(borrowing?.bindingConstraint)} />
        <Row label="Implied LVR" value={pct(borrowing?.impliedLvr)} />
        <Row label="Required equity" value={borrowing?.fundsToComplete.requiredEquity} />
        <Row label="Available equity" value={profile.purchaserStructure.availableCashEquity} />
        <Row label="Equity surplus / shortfall" value={borrowing?.fundsToComplete.equitySurplusShortfall} />
        <Row label="Post-settlement liquidity" value={borrowing?.fundsToComplete.postSettlementLiquidity} />
        <Row label="Key next action" value={borrowing?.requiredNextAction} />
      </CardContent>
    </Card>

    {/* Report Actions sits between the overview summary and the detailed
        sections: the reader has the headline outcome before being offered the
        buttons that act on it, and the actions still lead the detail. */}
    {ReportActions}

    <div className="grid gap-4 lg:grid-cols-2 xl:gap-5">
      <Section title="Transaction Snapshot"><Row label="State / territory" value={profile.dealProfile.state} /><Row label="Lease status" value={title(profile.dealProfile.leaseStatus)} /><Row label="Data source mode" value="Global Sync On" /></Section>
      <Section title="Borrowing Outcome"><Row label="Maximum loan" value={borrowing?.finalRiskAdjustedLoan} /><Row label="LVR cap" value={borrowing?.componentCaps.lvrCap} /><Row label="ICR cap" value={borrowing?.componentCaps.icrCap} /><Row label="Debt-yield cap" value={borrowing?.componentCaps.debtYieldCap} /></Section>
      <Section title="Purchase Ability"><Row label="Total acquisition costs" value={borrowing?.fundsToComplete.totalAcquisitionCosts} /><Row label="Total cost base" value={borrowing?.fundsToComplete.totalCostBase} /><Row label="Liquidity months" value={borrowing?.fundsToComplete.monthsDebtServiceCovered == null ? 'Pending' : `${borrowing.fundsToComplete.monthsDebtServiceCovered.toFixed(1)} months`} /></Section>
      <Section title="Income / NOI Summary"><Row label="Actual NOI" value={borrowing?.noi.actualNoi ?? profile.noiOutputs?.actualNoi} /><Row label="Stabilised NOI" value={borrowing?.noi.stabilisedNoi} /><Row label="Lender-adjusted NOI" value={borrowing?.noi.lenderAdjustedNoi} /></Section>
      <Section title="Valuation / Cap Rate Summary"><Row label="Estimated market value" value={profile.propertyValuation.estimatedMarketValue} /><Row label="Valuation confidence" value={title(profile.propertyValuation.valuationConfidence)} /><Row label="Cap rate output" value={(profile.capRateOutputs as any)?.capitalisationRate ? pct((profile.capRateOutputs as any).capitalisationRate) : 'Pending'} /></Section>
      <Section title="ICR / DSCR / Debt Yield Summary"><Row label="ICR" value={borrowing ? `${borrowing.icr.toFixed(2)}x` : 'Pending'} /><Row label="DSCR" value={borrowing ? `${borrowing.dscr.toFixed(2)}x` : 'Pending'} /><Row label="Debt yield" value={pct(borrowing?.debtYield)} /></Section>
      <Section title="GST Summary"><Row label="GST treatment" value={title(profile.acquisitionCosts.gstTreatment ?? profile.gstInputs.treatment)} /><Row label="Settlement cashflow" value={borrowing?.fundsToComplete.gstCashflowRequirement} /><Row label="Economic cost" value={borrowing?.fundsToComplete.gst.economicCost} /></Section>
      <Section title="DCF Summary"><Row label="Hold period" value={profile.dcfInputs.holdPeriodYears ? `${profile.dcfInputs.holdPeriodYears} years` : 'Pending'} /><Row label="Rental growth" value={profile.dcfInputs.rentalGrowthPct ? `${profile.dcfInputs.rentalGrowthPct}%` : 'Pending'} /><Row label="Exit cap" value={profile.dcfInputs.terminalCapRatePct ? `${profile.dcfInputs.terminalCapRatePct}%` : 'Pending'} /></Section>
      <Section title="Client Scenario Summary"><Row label="Selected client" value={clientScenario?.clientId} /><Row label="Scenario name" value={clientScenario?.scenarioName} /><Row label="Scenario type" value={clientScenario?.scenarioType} /><Row label="Scenario status" value={clientScenario?.status} /><Row label="Borrowing capacity movement" value={clientScenario ? clientScenario.resultingPosition.borrowingCapacity - clientScenario.currentPositionSnapshot.borrowingCapacity : undefined} /><Row label="Purchase ability" value={borrowing?.purchaseAbilityStatusLabel} /><Row label="Key constraint" value={clientScenario?.resultingPosition.keyConstraint} /><Row label="Risk rating" value={clientScenario?.resultingPosition.riskRating} /><Row label="Recommended next action" value={borrowing?.requiredNextAction} /><div className="flex flex-wrap gap-2 pt-2"><Button size="sm" variant="outline" onClick={() => handleSaveScenarioStatus('Draft')}>Save Scenario</Button><Button size="sm" variant="outline" onClick={() => handleSaveScenarioStatus('Recommended')}>Mark as Recommended</Button><Button size="sm" variant="outline" onClick={() => handleSaveScenarioStatus('Committed')}>Commit to Client Profile</Button><Button size="sm" variant="outline" onClick={handleExportScenarioReport}>Export Scenario Report</Button><Button size="sm" variant="outline" onClick={handleClientFacingSummary}>Generate Client-Facing Summary</Button></div></Section>
      <Section title="10-Year Cash Flow Summary"><Row label="Cash flow mode" value={title(tenYear?.summary.mode)} /><Row label="Year 1 pre-tax cashflow" value={tenYear?.summary.year1PreTaxCashflow} /><Row label="Year 1 after-tax cashflow" value={tenYear?.summary.year1AfterTaxCashflow} /><Row label="Year 10 property value" value={tenYear?.summary.year10PropertyValue} /><Row label="Year 10 loan balance" value={tenYear?.summary.year10LoanBalance} /><Row label="Year 10 equity" value={tenYear?.summary.year10Equity} /><Row label="Cumulative cashflow" value={tenYear?.summary.cumulativeAfterTaxCashflow} /><Row label="Levered IRR" value={tenYear?.summary.leveredIrr == null ? 'Pending' : `${(tenYear.summary.leveredIrr * 100).toFixed(1)}%`} /><Row label="Equity multiple" value={tenYear?.summary.equityMultiple == null ? 'Pending' : `${tenYear.summary.equityMultiple.toFixed(2)}x`} /><Row label="Business DSCR" value={tenYear?.summary.businessDscr == null ? 'Pending' : `${tenYear.summary.businessDscr.toFixed(2)}x`} /><Row label="Occupancy cost ratio" value={tenYear?.summary.occupancyCostRatio == null ? 'Pending' : `${(tenYear.summary.occupancyCostRatio * 100).toFixed(1)}%`} />{tenYear?.warnings.slice(0, 4).map((w, i) => <div key={i} className="rounded border border-brand-500/30 bg-brand-500/10 p-2 text-xs text-brand-100">{w}</div>)}</Section>
      {isIndustrial && <Section title="Industrial Metrics Summary"><Row label="GLA" value={profile.propertyValuation.lettableArea ? `${profile.propertyValuation.lettableArea} m²` : 'Pending'} /><Row label="Site area" value={profile.propertyValuation.landArea ? `${profile.propertyValuation.landArea} m²` : 'Pending'} /><Row label="Site cover" value={profile.propertyValuation.siteCoverageRatio ? pct(profile.propertyValuation.siteCoverageRatio) : 'Pending'} /><Row label="Industrial usability" value={title(borrowing?.riskRating)} /></Section>}
      <Section title="Risk Summary"><div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">{borrowing?.primaryReason ?? 'Run borrowing capacity to generate risk commentary. Until then, use missing-data and AI-estimate reviews to identify readiness risks before client delivery.'}</div>{borrowing?.warnings.slice(0, 5).map((w, i) => <div key={i} className="rounded-xl border border-brand-500/30 bg-brand-500/10 p-2.5 text-xs text-brand-800 dark:text-brand-100">{w}</div>)}</Section>
      <Section title="Fix the Deal"><div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">{borrowing?.commentarySections.fixTheDealSummary ?? 'No fix-the-deal strategy generated yet. Complete the borrowing inputs to surface the constraint and quantify required NOI or rent movement.'}</div><Row label="Required NOI" value={borrowing?.reverseCalculators.requiredNoiForProposedLoan} /><Row label="Required rent increase" value={borrowing?.reverseCalculators.requiredRentIncrease} /></Section>
      <Section title="Required Documents"><div className="grid gap-2 sm:grid-cols-2">{(docs?.slice(0, 10) ?? borrowing?.documentChecklist?.slice(0, 10) ?? []).map((d: any, i: number) => <div key={i} className="flex items-start gap-2 rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-xs text-muted-foreground shadow-sm"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /><span>{typeof d === 'string' ? d : d.documentName ?? d.name}</span></div>)}</div></Section>
    </div>

    <Dialog open={showMissing} onOpenChange={setShowMissing}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Missing Data & Specialist Review Items</DialogTitle>
          <DialogDescription>{unknowns.length} field(s) require operator input or specialist confirmation.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-2">
            {unknowns.length === 0 ? <p className="text-sm text-muted-foreground">No outstanding unknowns. All assumptions are verified or manually estimated.</p> :
              unknowns.map((u, i) => (
                <div key={i} className="rounded border bg-muted/10 px-3 py-2 text-sm">
                  <div className="font-medium">{u.fieldKey}</div>
                  <div className="text-xs text-muted-foreground">Tag: {u.confidenceTag}{(u as any).rationale ? ` • ${(u as any).rationale}` : ''}</div>
                </div>
              ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>

    <Dialog open={showAi} onOpenChange={setShowAi}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>AI Estimated Fields</DialogTitle>
          <DialogDescription>{aiFields.length} field(s) were filled by AI estimates. Review and confirm before client delivery.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-2">
            {aiFields.length === 0 ? <p className="text-sm text-muted-foreground">No AI-estimated fields in this deal.</p> :
              aiFields.map((a: any, i) => (
                <div key={i} className="rounded border bg-muted/10 px-3 py-2 text-sm">
                  <div className="font-medium">{a.fieldKey}</div>
                  <div className="text-xs text-muted-foreground">Confidence: {a.confidenceTag}{a.rationale ? ` • ${a.rationale}` : ''}</div>
                </div>
              ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  </div>;
}
