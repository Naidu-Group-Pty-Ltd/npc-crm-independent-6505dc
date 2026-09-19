/**
 * PdfImportMonitoring — Phase 11C admin monitoring + alerting dashboard.
 *
 * Surfaces the durable PDF import alert-event ledger: a severity/status-aware
 * rollup, the alert list, and permission-gated lifecycle actions (acknowledge /
 * resolve / suppress / mark false positive). Detection runs server-side via the
 * secure `pdf-import-monitoring` edge function. This page is NON-remediating —
 * it never repairs, retries, reruns, reconciles, mutates templates, or calls AI.
 */
import { Activity, ShieldCheck, Archive } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { Button } from '@/components/ui/button';
import { PdfImportMonitoringPanel } from '@/components/admin/pdfImport/PdfImportMonitoringPanel';
import { OperatorPermissionStatusPanel } from '@/components/admin/pdfImport/OperatorPermissionStatusPanel';
import { usePdfImportPermissions } from '@/hooks/usePdfImportPermissions';

export default function PdfImportMonitoring() {
  const { resolvedRole } = usePdfImportPermissions();

  return (
    <DashboardThemeFrame as="main" variant="page" className="min-w-0 space-y-6 px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Activity className="h-5 w-5" />
            PDF Import Monitoring &amp; Alerting
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Durable, rule-based alert events for the PDF import pipeline. Detection is
            severity- and status-aware and never triggers remediation. Managing alerts
            requires the monitoring-management capability.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Related runbook: <code>docs/pdf-import/runbooks/pdf-import-monitoring-alert-response-sop.md</code>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Final rollout lock: <code>docs/pdf-import/phase-11h-final-production-rollout-lock.md</code>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Monitoring details are internal. Use{' '}
            <Link to="/admin/pdf-import-client-reports" className="text-primary underline underline-offset-2">Client Reports</Link>{' '}
            for external-safe summaries.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/pdf-import-retention">
              <Archive className="mr-1 h-4 w-4" />
              Retention
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/pdf-import-diagnostics">
              <ShieldCheck className="mr-1 h-4 w-4" />
              Diagnostics
            </Link>
          </Button>
        </div>
      </div>

      <OperatorPermissionStatusPanel resolvedRole={resolvedRole} />

      <PdfImportMonitoringPanel />
    </DashboardThemeFrame>
  );
}
