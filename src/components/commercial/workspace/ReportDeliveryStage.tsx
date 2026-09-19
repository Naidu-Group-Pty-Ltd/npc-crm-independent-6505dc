/**
 * Report — the document, the design it uses, and where it is filed.
 *
 * ## What this replaces
 *
 * A button that set `reportGeneratedAt` in React state, dispatched a window
 * event and produced nothing. No PDF, no record, no storage — and a readiness
 * calculation of its own, derived from string-matched field names, that
 * disagreed with what the report route would accept.
 *
 * This stage does the real thing, through the path the rest of the product
 * already uses: `useCapacityReport` → an activated template if one is chosen,
 * otherwise the design-system renderer → WeasyPrint → private storage → a
 * render record against the assessment → the client's own Commercial /
 * Industrial tab. Nothing here is a second renderer, a second template picker
 * or a second history.
 *
 * ## Readiness is stated before the button, not enforced by it
 *
 * Blocking items are the ones the server will refuse. Warnings are disclosed
 * and do not stop a render, because a report generated with disclosure is a
 * legitimate outcome — see `workspaceReadiness.ts`.
 */

import { AlertTriangle, ArrowRight, CheckCircle2, FileDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ReportTemplateSelector } from '@/components/reports/ReportTemplateSelector';
import { cn } from '@/lib/utils';
import type { WorkspaceReadiness } from '@/lib/ciAssessment/workspaceReadiness';
import type { WorkspaceStageKey } from './workspaceStages';

export interface GeneratedRender {
  id: string;
  file_name: string;
  status: string;
  page_count: number | null;
  created_at: string;
}

interface Props {
  readiness: WorkspaceReadiness;
  /** Rendered reports already produced from this analysis. */
  renders: GeneratedRender[];
  generating: boolean;
  onGenerate: () => void;
  onGoToStage: (stage: WorkspaceStageKey) => void;
  /** Where the document is filed, once there is a client to file it against. */
  clientName: string | null;
  onOpenClient: (() => void) | null;
}

export function ReportDeliveryStage({
  readiness, renders, generating, onGenerate, onGoToStage, clientName, onOpenClient,
}: Props) {
  return (
    <div className="ci-step-panel space-y-5">
      <div>
        <h2 className="ci-step-heading">Report</h2>
        <p className="ci-step-description">
          The document states the figures of the saved calculation — not whatever is on screen when you
          press generate. It is rendered by the platform, filed against this analysis, and appears on the
          client’s record once one is linked.
        </p>
      </div>

      {/* ---- Readiness ---------------------------------------------------- */}
      <section
        className={cn(
          'rounded-lg border p-4',
          readiness.canGenerate && !readiness.warnings.length
            ? 'border-success/40 bg-success/5'
            : readiness.canGenerate ? 'border-warning/40 bg-warning/5' : 'border-destructive/40 bg-destructive/5',
        )}
        aria-live="polite"
      >
        <div className="flex items-start gap-2.5">
          {readiness.canGenerate && !readiness.warnings.length
            ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{readiness.headline}</p>

            {readiness.blocking.length ? (
              <div className="mt-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Blocking
                </p>
                <ul className="mt-1 space-y-1 text-sm">
                  {readiness.blocking.map((item) => (
                    <li key={item.message}>
                      {item.stage ? (
                        <button
                          type="button"
                          className="ci-issue-link"
                          onClick={() => onGoToStage(item.stage as WorkspaceStageKey)}
                        >
                          <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>{item.message}</span>
                        </button>
                      ) : item.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {readiness.warnings.length ? (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Disclosed in the document
                </p>
                <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                  {readiness.warnings.map((item) => (
                    <li key={item.message}>
                      {item.stage ? (
                        <button
                          type="button"
                          className="ci-issue-link"
                          onClick={() => onGoToStage(item.stage as WorkspaceStageKey)}
                        >
                          <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>{item.message}</span>
                        </button>
                      ) : item.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* ---- Template ----------------------------------------------------- */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Report template</h3>
        <p className="text-xs text-muted-foreground">
          The design the document is rendered with. Chosen once for the format and used everywhere it is
          produced; with nothing chosen, the platform’s own layout is used.
        </p>
        {/* The product's own selector, on the registered format id — not a
            second picker with its own idea of what a template is. */}
        <ReportTemplateSelector
          reportType="commercial_capacity"
          formatLabel="Commercial &amp; Industrial Capacity Report"
        />
      </section>

      {/* ---- Generate ----------------------------------------------------- */}
      <section className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button onClick={onGenerate} disabled={!readiness.canGenerate || generating}>
          {generating
            ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            : <FileDown className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {generating ? 'Generating…' : 'Generate report'}
        </Button>
        <p className="text-sm text-muted-foreground">
          {readiness.canGenerate
            ? 'Renders the document, files it against this analysis and downloads it.'
            : 'Resolve the blocking items above first.'}
        </p>
      </section>

      {/* ---- Where it goes ------------------------------------------------ */}
      <section className="rounded-lg border border-border bg-muted/20 p-4">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Where the document is filed</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Every render is recorded against this analysis with its file name, page count and whether the
          written analysis was included.{' '}
          {clientName
            ? `It also appears on ${clientName}’s Commercial / Industrial tab.`
            : 'Link a client on this stage and it appears on their Commercial / Industrial tab as well.'}
        </p>
        {clientName && onOpenClient ? (
          <Button variant="outline" size="sm" className="mt-3" onClick={onOpenClient}>
            Open {clientName}
          </Button>
        ) : null}

        {renders.length ? (
          <div className="ci-table-wrap mt-3" role="region" aria-label="Reports generated from this analysis" tabIndex={0}>
            <table className="ci-scenario-table">
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Pages</th>
                  <th scope="col">Generated</th>
                </tr>
              </thead>
              <tbody>
                {renders.map((render) => (
                  <tr key={render.id}>
                    <th scope="row" className="max-w-[260px] truncate font-mono text-xs" title={render.file_name}>
                      {render.file_name || '—'}
                    </th>
                    <td>
                      <Badge
                        variant="outline"
                        className={cn(
                          'ci-status-badge',
                          render.status === 'succeeded' ? 'ci-status-good'
                            : render.status === 'failed' ? 'ci-status-warn' : 'ci-status-progress',
                        )}
                      >
                        {render.status}
                      </Badge>
                    </td>
                    <td className="text-right font-mono tabular-nums">{render.page_count ?? '—'}</td>
                    <td className="text-sm text-muted-foreground">
                      {new Date(render.created_at).toLocaleString('en-AU')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No document has been generated from this analysis yet.</p>
        )}
      </section>
    </div>
  );
}
