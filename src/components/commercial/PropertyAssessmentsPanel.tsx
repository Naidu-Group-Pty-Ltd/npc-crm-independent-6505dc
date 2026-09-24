/**
 * The assessments made of one property, on the property's own page.
 *
 * "What have we assessed on this building?" had no answer: an assessment kept
 * no record of the register property it concerned, so the register could not
 * list it. Assessments started from the register now record the building
 * (`registerLink.pure.ts`), and this lists them — the relationship read from
 * the other end.
 *
 * "New assessment" here starts one OF this building and opens its Type step
 * (`useStartAssessment`). It is also where an old link naming a building
 * lands, because a link never creates a record on its own.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ExternalLink, FilePlus2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { AssessmentListRow } from '@/hooks/useCiAssessments';
import { listAssessmentsForProperty } from '@/lib/ciAssessment/assessmentManagement';
import { useStartAssessment } from '@/components/commercial/assessment/useStartAssessment';
import { formatMoney, toCents } from '@/lib/ciAssessment/money';
import type { RegisterDomain } from '@/lib/ciAssessment/registerProperty';
import {
  ASSESSMENT_STATUS_LABELS, assessmentTypeDefinition, type AssessmentType,
} from '@/lib/ciAssessment/types';

interface Props {
  domain: RegisterDomain;
  propertyId: string;
}

export function PropertyAssessmentsPanel({ domain, propertyId }: Props) {
  const navigate = useNavigate();
  const { start, starting } = useStartAssessment();
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{
    key: string; rows: AssessmentListRow[] | null; error: string | null;
  } | null>(null);

  // An answer is kept with the request it answers, so a retry or another
  // property reads as loading until its own answer arrives.
  const requestKey = `${propertyId}#${attempt}`;
  useEffect(() => {
    let cancelled = false;
    void listAssessmentsForProperty(propertyId).then((result) => {
      if (cancelled) return;
      setAnswer({
        key: `${propertyId}#${attempt}`,
        rows: result.error ? null : result.data ?? [],
        error: result.error ?? null,
      });
    });
    return () => { cancelled = true; };
  }, [propertyId, attempt]);
  const current = answer?.key === requestKey ? answer : null;
  const rows = current?.rows ?? null;
  const error = current?.error ?? null;
  const retry = () => setAttempt((value) => value + 1);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">Assessments of this property</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Finance assessments started from this record. Each keeps its own figures — this record only
              fills their blanks.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => void start({ domain, propertyId })}
            disabled={starting !== null}
            aria-busy={starting !== null}
          >
            {starting !== null
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              : <FilePlus2 className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            New assessment
          </Button>
        </div>

        {error ? (
          <div className="ci-warning-row ci-warning-critical" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <div className="min-w-0">
              <p>The assessments could not be read: {error}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={retry}>Try again</Button>
            </div>
          </div>
        ) : rows === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading assessments…
          </p>
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground">
            No assessments of this property yet. Start one to test a purchase, refinance or equity release on it —
            its address, value and areas are filled from this record.
          </p>
        ) : (
          <div className="ci-table-wrap" role="region" aria-label="Assessments of this property" tabIndex={0}>
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Assessment</TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Indicative capacity</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-12"><span className="sr-only">Open</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <p className="font-medium text-foreground">{row.title}</p>
                      <p className="text-xs text-muted-foreground">{row.reference}</p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {assessmentTypeDefinition(row.assessment_type as AssessmentType).label}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="ci-status-badge ci-status-neutral">
                        {ASSESSMENT_STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.maximum_indicative_loan ? formatMoney(toCents(row.maximum_indicative_loan)) : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(row.updated_at).toLocaleDateString('en-AU')}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon" variant="ghost" className="h-8 w-8"
                        onClick={() => navigate(`/commercial/assessments/${row.id}`)}
                        aria-label={`Open ${row.title}`}
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
