/**
 * Commercial & Industrial — the consolidated landing page.
 *
 * Replaces the previous property-register page. The changes that matter:
 *  - the hero panel is gone; the header is one compact row
 *  - one primary action ("New assessment") instead of duplicated
 *    "New Commercial" / "New Industrial" buttons — segment is a *field*, not a
 *    separate process
 *  - the empty state is an inline prompt, not a panel that owns the viewport
 *
 * ## One way in (September 2026 audit)
 *
 * The page offered four ways to start the same record and two editors for it:
 * the header's "New assessment", ten "Start from a transaction type" buttons,
 * and a "Standalone calculators" button whose workspace listed these same
 * assessments and edited them through a second set of stages.
 *
 * Now there is one "New assessment". It creates the draft and opens it on its
 * Type step, where the name and the transaction type are the first two
 * questions (`useStartAssessment`). The calculators workspace is retired into
 * the assessment's own "Valuation & forecast" step. An assessment can be
 * deleted, within the limits `deletion.pure.ts` sets, which is what lets a
 * click create again: a draft nobody wanted goes with one confirmation. A LINK
 * still never creates one (see below). The tabs name what they hold: the
 * Property register is where buildings live and assessments start from, and
 * Policy defaults are the assumptions every assessment starts under.
 *
 * See `docs/commercial/MODULE_STRUCTURE.md`.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchInput } from '@/components/ui/search-input';
import { ReportTemplateSelector } from '@/components/reports/ReportTemplateSelector';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Archive, ArchiveRestore, Building2, ExternalLink, Factory, FileDown, Loader2,
  MoreHorizontal, Plus, Settings2, FileText, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { ciAssessmentApi, useCiAssessments, type AssessmentListRow } from '@/hooks/useCiAssessments';
import { useCapacityReport } from '@/hooks/useCapacityReport';
import { isReportable } from '@/lib/reports/commercialCapacity/route.pure';
import { ASSESSMENT_STATUS_LABELS, type AssessmentStatus } from '@/lib/ciAssessment/types';
import { formatMoney, formatMultiple, formatRatioPercent, toCents } from '@/lib/ciAssessment/money';
import { clientCommercialIndustrialPath } from '@/lib/ciAssessment/clientRoute';
import { PROFILE_LABELS, PLATFORM_DEFAULT_POLICY, POLICY_VERSION, CALCULATION_ENGINE_VERSION } from '@/lib/ciAssessment/policy';
import { CommercialPropertyRegister } from '@/components/commercial/CommercialPropertyRegister';
import { PortfolioImpactTab } from '@/components/commercial/assessment/PortfolioImpactTab';
import { STARTING_BLANK, useStartAssessment } from '@/components/commercial/assessment/useStartAssessment';
import {
  DeleteAssessmentDialog, type DeletableAssessment,
} from '@/components/commercial/assessment/DeleteAssessmentDialog';
import { useMayOfferAssessmentDelete } from '@/components/commercial/assessment/useMayOfferAssessmentDelete';
import { readNewAssessmentLink, withoutNewAssessmentLink } from '@/lib/ciAssessment/legacyCalculatorLinks';
import { registerPropertyPath } from '@/lib/ciAssessment/registerProperty';

const STATUS_TONE: Record<AssessmentStatus, string> = {
  draft: 'ci-status-neutral',
  data_entry: 'ci-status-progress',
  ready_to_calculate: 'ci-status-progress',
  calculated: 'ci-status-good',
  requires_review: 'ci-status-warn',
  completed: 'ci-status-good',
  linked: 'ci-status-good',
  archived: 'ci-status-neutral',
};

const STATUS_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'data_entry', label: 'In progress' },
  { value: 'calculated', label: 'Calculated' },
  { value: 'requires_review', label: 'Requires review' },
  { value: 'completed', label: 'Completed' },
  { value: 'linked', label: 'Linked' },
  { value: 'archived', label: 'Archived' },
];

const SEGMENT_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'all', label: 'Commercial and industrial' },
  { value: 'commercial', label: 'Commercial only' },
  { value: 'industrial', label: 'Industrial only' },
];

function MetricTile({
  label, value, note, alert,
}: {
  label: string;
  value: string;
  note?: string;
  alert?: boolean;
}) {
  return (
    <div className={cn('ci-metric-tile', alert && 'ci-metric-tile-alert')}>
      <p className="ci-metric-label">{label}</p>
      <p className="ci-metric-value">{value}</p>
      {note ? <p className="ci-metric-note">{note}</p> : null}
    </div>
  );
}

export default function CommercialIndustrial() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [segment, setSegment] = useState('all');
  const [pendingDelete, setPendingDelete] = useState<DeletableAssessment | null>(null);
  const mayOfferDelete = useMayOfferAssessmentDelete();

  const activeTab = searchParams.get('tab') ?? 'assessments';
  const setTab = (tab: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('tab', tab);
      return next;
    }, { replace: true });
  };

  const filters = useMemo(() => ({
    status: status === 'all' ? undefined : status,
    segment: segment === 'all' ? undefined : segment,
    search: search.trim() || undefined,
  }), [status, segment, search]);

  const { rows, loading, refresh, metrics } = useCiAssessments(filters);
  const { generatingId, generate } = useCapacityReport();

  const { start: startAssessment, starting } = useStartAssessment();
  const startingBlank = starting === STARTING_BLANK;

  /**
   * `?new=assessment[&domain=…&propertyId=…]` is a LINK asking for a new
   * assessment: the old "Send to Calculators" links and the ones this page used
   * to open a dialog from. A link never creates a record, because a refresh,
   * the Back button or a bookmark is not somebody asking for one. A link
   * naming a building goes to that building's page, where "New assessment"
   * starts one of it in one click. One naming no building is simply this list.
   * Either way the request is REPLACED, so Back does not bring it round again.
   */
  const linkRequest = readNewAssessmentLink(searchParams);
  const hasLinkRequest = linkRequest !== null;
  const linkedDomain = linkRequest?.property?.domain ?? null;
  const linkedPropertyId = linkRequest?.property?.propertyId ?? null;
  useEffect(() => {
    if (!hasLinkRequest) return;
    if (linkedDomain && linkedPropertyId) {
      navigate(registerPropertyPath({ domain: linkedDomain, propertyId: linkedPropertyId }), { replace: true });
    } else {
      setSearchParams((current) => withoutNewAssessmentLink(current), { replace: true });
    }
  }, [hasLinkRequest, linkedDomain, linkedPropertyId, navigate, setSearchParams]);

  const archive = async (row: AssessmentListRow) => {
    const result = row.archived_at
      ? await ciAssessmentApi.restore(row.id)
      : await ciAssessmentApi.archive(row.id);
    if (result.error) {
      toast({ title: 'Action failed', description: result.error, variant: 'destructive' });
      return;
    }
    toast({ title: row.archived_at ? 'Assessment restored' : 'Assessment archived' });
    await refresh();
  };

  return (
    <div className="ci-foundation ci-shell space-y-5">
      {/* ---- Compact header ------------------------------------------- */}
      <header className="ci-page-header">
        <div className="min-w-0">
          <h1 className="ci-page-title">
            <span className="ci-page-title-icon">
              <Building2 className="h-5 w-5" aria-hidden="true" />
            </span>
            Commercial &amp; Industrial
          </h1>
          <p className="ci-page-subtitle">
            Finance assessments for office, retail, warehouse and logistics assets — borrowing capacity,
            valuation, portfolio impact and stress testing, from intake to the client&apos;s report.
          </p>
        </div>
        <div className="ci-page-actions">
          <Button size="sm" onClick={() => void startAssessment()} disabled={starting !== null} aria-busy={startingBlank}>
            {startingBlank
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              : <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            New assessment
          </Button>
        </div>
      </header>

      {/* ---- Metrics --------------------------------------------------- */}
      <section aria-label="Assessment summary">
        <dl className="ci-metric-strip">
          <MetricTile label="Active assessments" value={String(metrics.active)} note="Drafts and work in progress" />
          <MetricTile label="Completed" value={String(metrics.completed)} note="Including linked to a client" />
          <MetricTile label="Total proposed lending" value={formatMoney(toCents(metrics.totalProposedLending), { compact: true })} />
          <MetricTile label="Average proposed LVR" value={metrics.averageProposedLvr > 0 ? formatRatioPercent(metrics.averageProposedLvr) : '—'} />
          <MetricTile
            label="Requiring review" value={String(metrics.requiringReview)}
            note={metrics.requiringReview > 0 ? 'Needs specialist or compliance review' : 'Nothing outstanding'}
            alert={metrics.requiringReview > 0}
          />
        </dl>
      </section>

      {/* ---- Tabs ------------------------------------------------------ */}
      <Tabs value={activeTab} onValueChange={setTab}>
        <TabsList className="ci-tabs-list">
          <TabsTrigger className="ci-tab" value="assessments">Assessments</TabsTrigger>
          <TabsTrigger className="ci-tab" value="properties">Property register</TabsTrigger>
          <TabsTrigger className="ci-tab" value="portfolio">Portfolio impact</TabsTrigger>
          <TabsTrigger className="ci-tab" value="reports">Reports</TabsTrigger>
          <TabsTrigger className="ci-tab" value="settings">Policy defaults</TabsTrigger>
        </TabsList>

        {/* ---- Assessments -------------------------------------------- */}
        <TabsContent value="assessments" className="mt-4 space-y-4">
          <div className="ci-toolbar">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search by name or reference"
              aria-label="Search assessments"
              containerClassName="w-full max-w-sm"
            />
            <div className="ci-toolbar-filters">
              <Select value={segment} onValueChange={setSegment}>
                <SelectTrigger className="w-52" aria-label="Filter by segment"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEGMENT_FILTERS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-44" aria-label="Filter by status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* The per-row Generate icons below produce the Capacity Report, and
              which template it comes out in was previously answerable only on
              a client-modal tab. One row for the list — the selection is per
              format and every row's Generate reads it. */}
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <ReportTemplateSelector
              reportType="commercial_capacity"
              formatLabel="Commercial & Industrial Capacity"
            />
          </div>

          {loading ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading assessments…
            </div>
          ) : !rows.length ? (
            <div className="ci-inline-empty">
              <div className="ci-inline-empty-copy">
                <p className="ci-inline-empty-title">
                  {search || status !== 'all' || segment !== 'all'
                    ? 'No assessments match these filters'
                    : 'No assessments yet'}
                </p>
                <p className="ci-inline-empty-body">
                  {search || status !== 'all' || segment !== 'all'
                    ? 'Clear the filters to see everything, or start a new assessment.'
                    : 'Start one to work through the property, borrower, portfolio and loan structure, then see indicative capacity and portfolio impact.'}
                </p>
              </div>
              <Button size="sm" onClick={() => void startAssessment()} disabled={starting !== null} aria-busy={startingBlank}>
                {startingBlank
                  ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                  : <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                New assessment
              </Button>
            </div>
          ) : (
            <div className="ci-table-wrap" role="region" aria-label="Assessments" tabIndex={0}>
              <Table className="min-w-[1000px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[240px]">Assessment</TableHead>
                    <TableHead>Segment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Requested</TableHead>
                    <TableHead className="text-right">Indicative capacity</TableHead>
                    <TableHead className="text-right">LVR</TableHead>
                    <TableHead className="text-right">DSCR</TableHead>
                    <TableHead>Binding constraint</TableHead>
                    <TableHead className="ci-sticky-actions w-28"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <button
                          type="button"
                          className="text-left font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => navigate(`/commercial/assessments/${row.id}`)}
                        >
                          {row.title}
                        </button>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {row.reference}
                          {row.client_id ? (
                            <>
                              {' · '}
                              {/* The link is the point of the label: a row that
                                  says "linked to client" and cannot reach that
                                  client makes the reader search for someone
                                  they were already looking at. */}
                              <button
                                type="button"
                                className="underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() => navigate(clientCommercialIndustrialPath(row.client_id!))}
                              >
                                Open client
                              </button>
                            </>
                          ) : ' · Not linked'}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span className="ci-segment-tag">
                          {row.segment === 'industrial'
                            ? <Factory className="h-3 w-3" aria-hidden="true" />
                            : <Building2 className="h-3 w-3" aria-hidden="true" />}
                          {row.segment === 'industrial' ? 'Industrial' : 'Commercial'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('ci-status-badge', STATUS_TONE[row.status])}>
                          {ASSESSMENT_STATUS_LABELS[row.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {row.requested_loan ? formatMoney(toCents(row.requested_loan)) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold tabular-nums">
                        {row.maximum_indicative_loan ? formatMoney(toCents(row.maximum_indicative_loan)) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {row.proposed_lvr ? formatRatioPercent(row.proposed_lvr) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {row.proposed_dscr ? formatMultiple(row.proposed_dscr) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.binding_constraint ?? '—'}
                      </TableCell>
                      <TableCell className="ci-sticky-actions">
                        <div className="flex justify-end gap-1">
                          {/* Reporting is offered only where it is possible.
                              The action is absent rather than disabled on an
                              incomplete assessment: a disabled icon in a dense
                              row of icons is a control nobody can interpret,
                              and this one has a precondition the row already
                              shows in its status column. */}
                          {isReportable(row.status) ? (
                            <Button
                              size="icon" variant="ghost" className="h-8 w-8"
                              onClick={() => void generate(row.id)}
                              disabled={generatingId !== null}
                              aria-label={`Generate the capacity report for ${row.title}`}
                            >
                              {generatingId === row.id
                                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                : <FileDown className="h-4 w-4" aria-hidden="true" />}
                            </Button>
                          ) : null}
                          <Button
                            size="icon" variant="ghost" className="h-8 w-8"
                            onClick={() => navigate(`/commercial/assessments/${row.id}`)}
                            aria-label={`Open ${row.title}`}
                          >
                            <ExternalLink className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          {/* Managing the record — archive, restore, delete —
                              sits behind one menu, as it does in the
                              assessment's own header: a destructive act is
                              not a bare icon in a dense row. */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground"
                                aria-label={`More actions for ${row.title}`}
                              >
                                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => { void archive(row); }}>
                                {row.archived_at
                                  ? <><ArchiveRestore className="mr-2 h-4 w-4" aria-hidden="true" /> Restore</>
                                  : <><Archive className="mr-2 h-4 w-4" aria-hidden="true" /> Archive</>}
                              </DropdownMenuItem>
                              {mayOfferDelete ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() => setPendingDelete({ id: row.id, title: row.title, reference: row.reference })}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" /> Delete…
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ---- Property register ---------------------------------------- */}
        <TabsContent value="properties" className="mt-4">
          <CommercialPropertyRegister
            onStartAssessment={(property) => void startAssessment(property)}
            starting={starting}
          />
        </TabsContent>

        {/* ---- Portfolio impact ---------------------------------------- */}
        <TabsContent value="portfolio" className="mt-4">
          <PortfolioImpactTab rows={rows} loading={loading} />
        </TabsContent>

        {/* ---- Reports -------------------------------------------------- */}
        <TabsContent value="reports" className="mt-4 space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
              <FileText className="h-4 w-4 text-primary" aria-hidden="true" /> Assessment reports
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              A report is generated from a completed assessment&apos;s saved calculation run, so it always
              reflects the engine and policy versions in force when the figures were produced. It is
              white-labelled to your firm, and carries an AI reading of the figures — what bound the
              capacity, what the risks are, and what would move the result — clearly marked as such.
            </p>
            {/* The choice, on the surface that generates. Every Generate below
                reads the same per-format selection. */}
            <ReportTemplateSelector
              reportType="commercial_capacity"
              formatLabel="Commercial & Industrial Capacity"
              className="mt-3"
            />
          </div>

          {rows.filter((row) => row.status === 'completed' || row.status === 'linked').length ? (
            <div className="ci-table-wrap" role="region" aria-label="Completed assessments" tabIndex={0}>
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Assessment</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-right">Indicative capacity</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows
                    .filter((row) => row.status === 'completed' || row.status === 'linked')
                    .map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium text-foreground">{row.title}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.outcome?.replace(/_/g, ' ') ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {row.maximum_indicative_loan ? formatMoney(toCents(row.maximum_indicative_loan)) : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(row.updated_at).toLocaleDateString('en-AU')}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => void generate(row.id)}
                              disabled={generatingId !== null}
                            >
                              {generatingId === row.id
                                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                : <FileDown className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                              {generatingId === row.id ? 'Generating…' : 'Generate'}
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => navigate(`/commercial/assessments/${row.id}?step=results`)}
                            >
                              Open
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="ci-inline-empty">
              <div className="ci-inline-empty-copy">
                <p className="ci-inline-empty-title">No completed assessments yet</p>
                <p className="ci-inline-empty-body">
                  Complete an assessment to make it available for reporting.
                </p>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ---- Policy defaults ------------------------------------------- */}
        <TabsContent value="settings" className="mt-4 space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
              <Settings2 className="h-4 w-4 text-primary" aria-hidden="true" /> Platform default assumptions
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              The assumptions every assessment starts under, before any lender profile or scenario override is applied.
              A completed assessment keeps the assumptions it was calculated under, so changing these
              never rewrites a historical result.
            </p>
            <dl className="mt-3 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-card px-3 py-2.5">
                <dt className="ci-result-cell-label">Engine version</dt>
                <dd className="mt-0.5 font-mono text-sm text-foreground">{CALCULATION_ENGINE_VERSION}</dd>
              </div>
              <div className="bg-card px-3 py-2.5">
                <dt className="ci-result-cell-label">Policy version</dt>
                <dd className="mt-0.5 font-mono text-sm text-foreground">{POLICY_VERSION}</dd>
              </div>
              <div className="bg-card px-3 py-2.5">
                <dt className="ci-result-cell-label">Default max LVR</dt>
                <dd className="mt-0.5 font-mono text-sm text-foreground">{(PLATFORM_DEFAULT_POLICY.maxLvr * 100).toFixed(1)}%</dd>
              </div>
              <div className="bg-card px-3 py-2.5">
                <dt className="ci-result-cell-label">Default max LTC</dt>
                <dd className="mt-0.5 font-mono text-sm text-foreground">{(PLATFORM_DEFAULT_POLICY.maxLtc * 100).toFixed(1)}%</dd>
              </div>
              <div className="bg-card px-3 py-2.5">
                <dt className="ci-result-cell-label">Minimum DSCR</dt>
                <dd className="mt-0.5 font-mono text-sm text-foreground">{PLATFORM_DEFAULT_POLICY.minDscr.toFixed(2)}x</dd>
              </div>
              <div className="bg-card px-3 py-2.5">
                <dt className="ci-result-cell-label">Minimum ICR</dt>
                <dd className="mt-0.5 font-mono text-sm text-foreground">{PLATFORM_DEFAULT_POLICY.minIcr.toFixed(2)}x</dd>
              </div>
              <div className="bg-card px-3 py-2.5">
                <dt className="ci-result-cell-label">Assessment buffer / floor</dt>
                <dd className="mt-0.5 font-mono text-sm text-foreground">
                  +{PLATFORM_DEFAULT_POLICY.assessmentBufferPct}% / {PLATFORM_DEFAULT_POLICY.assessmentFloorRatePct}%
                </dd>
              </div>
              <div className="bg-card px-3 py-2.5">
                <dt className="ci-result-cell-label">Rental shading</dt>
                <dd className="mt-0.5 font-mono text-sm text-foreground">{PLATFORM_DEFAULT_POLICY.rentalShadingPct}%</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Lender policy profiles</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Selected per assessment on the Loan structure step. No profile is treated as universal truth —
              each is a modelled shape, not a lender&apos;s actual credit policy.
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {Object.entries(PROFILE_LABELS).map(([key, label]) => (
                <li key={key}>
                  <span className="ci-segment-tag">{label}</span>
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>
      </Tabs>

      <DeleteAssessmentDialog
        assessment={pendingDelete}
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        onDeleted={() => { void refresh(); }}
        onArchived={() => { void refresh(); }}
      />
    </div>
  );
}
