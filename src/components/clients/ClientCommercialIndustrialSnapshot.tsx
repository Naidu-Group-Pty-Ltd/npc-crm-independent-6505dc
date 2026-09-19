/**
 * The Commercial & Industrial line on a client's Overview.
 *
 * The full record lives on its own tab; this is the sentence the Overview owes
 * a reader — that this client has commercial finance work at all, where it has
 * got to, and what the last calculation said. Without it, a client whose whole
 * relationship is a $4m industrial purchase looks, on the page most people
 * open first, like a client with nothing on file.
 *
 * Deliberately quiet: it renders **nothing** for a client with no linked
 * assessments, and nothing while it is loading. An Overview is a summary, and a
 * summary that shows an empty state for every module a client does not use is
 * a page of empty states.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Building2, Factory, Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ciAssessmentApi, type ClientCiWorkspace } from '@/hooks/useCiAssessments';
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

interface Props {
  clientId: string;
  /** Sends the reader to the tab holding the detail. */
  onOpenTab: () => void;
}

export function ClientCommercialIndustrialSnapshot({ clientId, onOpenTab }: Props) {
  const [workspace, setWorkspace] = useState<ClientCiWorkspace | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ciAssessmentApi.clientWorkspace(clientId).then((result) => {
      // Silent on failure: the Overview is not the place to report that an
      // optional module could not be read, and the tab itself says so plainly.
      if (!cancelled && result.data) setWorkspace(result.data);
    });
    return () => { cancelled = true; };
  }, [clientId]);

  const assessments = workspace?.assessments ?? [];
  const candidates = workspace?.candidates ?? [];

  /**
   * Started for this client, never linked.
   *
   * Worth one line on the Overview because the alternative is what was
   * reported: a client created out of an assessment, and a profile that shows
   * no sign the assessment exists. The tab holds the action; this says there
   * is something to act on.
   */
  if (!assessments.length) {
    if (!candidates.length) return null;
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Landmark className="h-4 w-4 text-primary" aria-hidden="true" />
            Commercial / Industrial
          </CardTitle>
          <Button size="sm" variant="outline" className="h-7" onClick={onOpenTab}>
            Open
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {candidates.length === 1 ? 'An assessment was' : `${candidates.length} assessments were`}
            {' '}started for this client but not linked yet, so nothing from
            {candidates.length === 1 ? ' it' : ' them'} appears here. The Commercial / Industrial tab
            offers the step that links {candidates.length === 1 ? 'it' : 'them'}.
          </p>
        </CardContent>
      </Card>
    );
  }

  // The most recently updated assessment is the one being worked on, and the
  // one whose figures answer "where is this client up to".
  const latest = assessments[0];
  const reports = (workspace?.renders ?? []).filter((render) => render.status === 'succeeded').length;
  const SegmentIcon = latest.segment === 'industrial' ? Factory : Building2;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Landmark className="h-4 w-4 text-primary" aria-hidden="true" />
          Commercial / Industrial
        </CardTitle>
        <Button size="sm" variant="outline" className="h-7" onClick={onOpenTab}>
          View all {assessments.length > 1 ? `(${assessments.length})` : ''}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-semibold text-foreground">{latest.title}</span>
          <span className="font-mono text-xs text-muted-foreground">{latest.reference}</span>
          <Badge
            variant="outline"
            className={cn('ci-status-badge', STATUS_TONE[latest.status] ?? 'ci-status-neutral')}
          >
            {ASSESSMENT_STATUS_LABELS[latest.status as AssessmentStatus] ?? latest.status.replace(/_/g, ' ')}
          </Badge>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Requested</dt>
            <dd className="font-mono text-sm tabular-nums text-foreground">
              {latest.requested_loan ? formatMoney(toCents(latest.requested_loan)) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Indicative capacity</dt>
            <dd className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {latest.maximum_indicative_loan ? formatMoney(toCents(latest.maximum_indicative_loan)) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">LVR</dt>
            <dd className="font-mono text-sm tabular-nums text-foreground">
              {latest.proposed_lvr ? formatRatioPercent(latest.proposed_lvr) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">DSCR</dt>
            <dd className="font-mono text-sm tabular-nums text-foreground">
              {latest.proposed_dscr ? formatMultiple(latest.proposed_dscr) : '—'}
            </dd>
          </div>
        </dl>

        {latest.binding_constraint ? (
          <p className="text-xs text-muted-foreground">
            Bound by {latest.binding_constraint}.
            {reports ? ` ${reports} capacity report${reports === 1 ? '' : 's'} generated.` : ''}
          </p>
        ) : reports ? (
          <p className="text-xs text-muted-foreground">
            {reports} capacity report{reports === 1 ? '' : 's'} generated.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
