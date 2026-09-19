/**
 * PdfImportRetention — Phase 11E admin retention + cleanup governance page.
 *
 * Surfaces DRY-RUN artifact retention candidates: a policy-driven, risk-aware,
 * permission-gated cleanup-candidate review workflow. No physical cleanup,
 * archival, or metadata compaction is performed — candidates are recommendations
 * only, pending future explicit approval.
 */
import { Archive, Activity } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { Button } from '@/components/ui/button';
import { PdfImportRetentionPanel } from '@/components/admin/pdfImport/PdfImportRetentionPanel';
import { OperatorPermissionStatusPanel } from '@/components/admin/pdfImport/OperatorPermissionStatusPanel';
import { usePdfImportPermissions } from '@/hooks/usePdfImportPermissions';

export default function PdfImportRetention() {
  const { resolvedRole } = usePdfImportPermissions();

  return (
    <DashboardThemeFrame as="main" variant="page" className="min-w-0 space-y-6 px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Archive className="h-5 w-5" />
            PDF Import Retention
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Dry-run artifact retention + cleanup governance. Candidates are policy-driven,
            risk-classified recommendations only — no files or rows are deleted, archived,
            or compacted. Managing candidates requires the retention-management capability.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Related runbook: <code>docs/pdf-import/runbooks/pdf-import-retention-candidate-review-sop.md</code>
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/pdf-import-monitoring">
            <Activity className="mr-1 h-4 w-4" />
            Monitoring
          </Link>
        </Button>
      </div>

      <OperatorPermissionStatusPanel resolvedRole={resolvedRole} />

      <PdfImportRetentionPanel />
    </DashboardThemeFrame>
  );
}
