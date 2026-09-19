/**
 * The client profile's Commercial / Industrial tab.
 *
 * Everything the C&I module holds about one client, read in a single request
 * (`client_workspace` on `manage-ci-assessments`): the assessments linked to
 * them, the calculation runs behind those assessments, the capacity reports
 * generated from them, and the link history — who attached what, and when.
 *
 * Two deliberate echoes of the module's own pages, so the two views cannot
 * drift: status tones and figure formatting come from the same helpers the
 * assessments list uses, and Generate report is the same `useCapacityReport`
 * hook behind the same completed-only rule. This tab is a *view* of the
 * client's record — creating and editing assessments stays in the module,
 * which is one click away on every row.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReportTemplateSelector } from '@/components/reports/ReportTemplateSelector';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Building2, ExternalLink, Factory, FileDown, FileText, Landmark, Link2, Loader2, Paperclip,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ciAssessmentApi, type ClientCiWorkspace } from '@/hooks/useCiAssessments';
import { useCapacityReport } from '@/hooks/useCapacityReport';
import { isReportable } from '@/lib/reports/commercialCapacity/route.pure';
import { ASSESSMENT_STATUS_LABELS, type AssessmentStatus } from '@/lib/ciAssessment/types';
import { formatMoney, formatMultiple, formatRatioPercent, toCents } from '@/lib/ciAssessment/money';

const STATUS_TONE: Record<string, string> = {
  draft: 'ci-status-neutral',
  data_entry: 'ci-status-progress',
  ready_to_calculate: 'ci-status-progress',
  calculated: 'ci-status-good',
  requires_review: 'ci-status-warn',
  completed: 'ci-status-good',
  linked: 'ci-status-good',
  archived: 'ci-status-neutral',
};

/** How a value reached an assessment, in the words the workflow uses. */
const UPLOAD_SOURCE_LABELS: Record<string, string> = {
  document_import: 'Read from a document',
  url_import: 'Read from a listing',
  client_profile: 'From the client record',
  ai_estimate: 'Estimated',
};

function statusLabel(status: string): string {
  return ASSESSMENT_STATUS_LABELS[status as AssessmentStatus] ?? status.replace(/_/g, ' ');
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-AU') : '—';
}

interface Props {
  clientId: string;
}

export function ClientCommercialIndustrialTab({ clientId }: Props) {
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<ClientCiWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { generatingId, generate } = useCapacityReport();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await ciAssessmentApi.clientWorkspace(clientId);
    setLoading(false);
    if (result.error || !result.data) {
      setError(result.error ?? 'Could not load the Commercial & Industrial records.');
      return;
    }
    setWorkspace(result.data);
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  // A fresh render row appears only after the server finishes, so reload the
  // tab once a report completes rather than showing a stale reports table.
  const generateAndRefresh = useCallback(async (assessmentId: string) => {
    await generate(assessmentId);
    await load();
  }, [generate, load]);

  if (loading) {
    return (
      <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading Commercial &amp; Industrial records…
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-destructive">{error}</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={load}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  const assessments = workspace?.assessments ?? [];
  const renders = workspace?.renders ?? [];
  const runs = workspace?.runs ?? [];
  const links = workspace?.links ?? [];
  const uploads = workspace?.uploads ?? [];
  const candidates = workspace?.candidates ?? [];

  /**
   * An assessment that belongs to this client but is not linked to them.
   *
   * Rendered above everything else, and on its own where nothing is linked at
   * all, because it is the answer to the question the empty tab provoked:
   * "I created this client from an assessment — where is it?". Linking happens
   * on the assessment's own final step, so this offers that step rather than
   * doing it from here, where none of the reconciliation could be shown.
   */
  const candidateCard = candidates.length ? (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Link2 className="h-4 w-4 text-warning" aria-hidden="true" />
          Not linked yet ({candidates.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {candidates.length === 1 ? 'This assessment was' : 'These assessments were'} started for this
          client but never linked, so nothing from {candidates.length === 1 ? 'it' : 'them'} appears
          below. Linking happens on the assessment's final step, where the portfolio is reconciled
          against what is already on file.
        </p>
        <ul className="space-y-2">
          {candidates.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">{row.title}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {row.segment === 'industrial'
                    ? <Factory className="h-3 w-3" aria-hidden="true" />
                    : <Building2 className="h-3 w-3" aria-hidden="true" />}
                  {row.reference} · {statusLabel(row.status)}
                  {row.maximum_indicative_loan
                    ? ` · ${formatMoney(toCents(row.maximum_indicative_loan))} indicative`
                    : ''}
                </span>
              </span>
              <Button
                size="sm"
                onClick={() => navigate(`/commercial/assessments/${row.id}?step=link`)}
              >
                <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Link this assessment
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  ) : null;

  if (!assessments.length) {
    return (
      <div className="space-y-4">
        {candidateCard}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-foreground">No Commercial &amp; Industrial assessments linked</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Assessments are linked to a client on the final step of the assessment workspace. Once
                  linked, the assessment, its calculations, the documents read into it and its capacity
                  reports all appear here.
                </p>
                <Button className="mt-3" size="sm" variant="outline" onClick={() => navigate('/commercial')}>
                  Open Commercial / Industrial
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const titleFor = (assessmentId: string) =>
    assessments.find((row) => row.id === assessmentId)?.title ?? 'Assessment';

  return (
    <div className="space-y-4">
      {candidateCard}

      {/* ---- Linked assessments --------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Landmark className="h-4 w-4 text-primary" aria-hidden="true" />
            Linked assessments ({assessments.length})
          </CardTitle>
          {/* Once for the card rather than once per row: the choice is per
              format, and every Generate report action below uses it. */}
          <ReportTemplateSelector
            reportType="commercial_capacity"
            formatLabel="Commercial & Industrial Capacity"
            className="mt-3"
          />
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto" role="region" aria-label="Linked Commercial and Industrial assessments" tabIndex={0}>
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">Assessment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Requested</TableHead>
                  <TableHead className="text-right">Indicative capacity</TableHead>
                  <TableHead className="text-right">LVR</TableHead>
                  <TableHead className="text-right">DSCR</TableHead>
                  <TableHead>Linked</TableHead>
                  <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assessments.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <p className="font-semibold text-foreground">{row.title}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        {row.segment === 'industrial'
                          ? <Factory className="h-3 w-3" aria-hidden="true" />
                          : <Building2 className="h-3 w-3" aria-hidden="true" />}
                        {row.reference}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('ci-status-badge', STATUS_TONE[row.status] ?? 'ci-status-neutral')}>
                        {statusLabel(row.status)}
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
                    <TableCell className="text-sm text-muted-foreground">{formatDate(row.linked_at)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {isReportable(row.status) ? (
                          <Button
                            size="icon" variant="ghost" className="h-8 w-8"
                            onClick={() => void generateAndRefresh(row.id)}
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
                          onClick={() => navigate(`/commercial/assessments/${row.id}?step=results`)}
                          aria-label={`Open ${row.title}`}
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ---- Uploaded information --------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Paperclip className="h-4 w-4 text-primary" aria-hidden="true" />
            Uploaded information ({uploads.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {uploads.length ? (
            <>
              <div className="overflow-x-auto" role="region" aria-label="Documents read into these assessments" tabIndex={0}>
                <Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead>
                      <TableHead>Assessment</TableHead>
                      <TableHead>Read as</TableHead>
                      <TableHead className="text-right">Fields</TableHead>
                      <TableHead>Read</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {uploads.map((upload) => (
                      <TableRow key={`${upload.assessmentId}-${upload.source}-${upload.name}`}>
                        <TableCell className="max-w-[280px] truncate" title={upload.name}>{upload.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{titleFor(upload.assessmentId)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{UPLOAD_SOURCE_LABELS[upload.source] ?? upload.source.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{upload.fields}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(upload.capturedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Said plainly, because "uploaded" invites the reader to look
                  for a download that does not exist: the pack is read in the
                  browser and only its values are kept. */}
              <p className="mt-2 text-xs text-muted-foreground">
                The intake pack and its supporting documents are read in the browser and are not
                stored — what is kept is the values they filled in, and this record of where each
                one came from.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing has been imported into these assessments. Values dropped in through the intake
              pack, or read from a contract or valuation, are listed here with the document they came
              from.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---- Generated reports ------------------------------------------ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
            Capacity reports ({renders.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {renders.length ? (
            <div className="overflow-x-auto" role="region" aria-label="Generated capacity reports" tabIndex={0}>
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Report</TableHead>
                    <TableHead>Assessment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Pages</TableHead>
                    <TableHead>AI analysis</TableHead>
                    <TableHead>Generated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renders.map((render) => (
                    <TableRow key={render.id}>
                      <TableCell className="max-w-[260px] truncate font-mono text-xs" title={render.file_name}>
                        {render.file_name || '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{titleFor(render.assessment_id)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'ci-status-badge',
                            render.status === 'succeeded'
                              ? 'ci-status-good'
                              : render.status === 'failed' ? 'ci-status-warn' : 'ci-status-progress',
                          )}
                        >
                          {render.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{render.page_count ?? '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {render.has_analysis ? 'Included' : render.analysis_note ?? 'Not included'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(render.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No reports generated yet. Use the download action on a completed assessment above — the
              report is white-labelled, carries the AI analysis of the figures, and downloads on the spot.
              Each generation is also recorded here.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---- Calculation history ---------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
            Calculation and link history
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {runs.length ? (
            <div className="overflow-x-auto" role="region" aria-label="Calculation runs" tabIndex={0}>
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Assessment</TableHead>
                    <TableHead>Scenario</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-right">Indicative capacity</TableHead>
                    <TableHead>Engine</TableHead>
                    <TableHead>Run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="text-sm text-muted-foreground">{titleFor(run.assessment_id)}</TableCell>
                      <TableCell className="text-sm">{run.scenario_key}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {run.outcome ? run.outcome.replace(/_/g, ' ') : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {run.maximum_indicative_loan ? formatMoney(toCents(run.maximum_indicative_loan)) : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        v{run.engine_version} / {run.policy_version}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(run.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No calculation runs recorded.</p>
          )}

          {links.length ? (
            <p className="text-xs text-muted-foreground">
              {links.filter((link) => !link.unlinked_at).length} active link(s),{' '}
              {links.filter((link) => link.unlinked_at).length} historical. Every link records the
              reconciliation decisions made at the time; unlinking preserves the history.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
