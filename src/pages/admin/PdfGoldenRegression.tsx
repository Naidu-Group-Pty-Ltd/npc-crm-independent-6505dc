/**
 * PdfGoldenRegression — Phase 9B admin page.
 * Thin wrapper around GoldenRegressionRunConsole; prefills from URL query params.
 */
import { useSearchParams, Link } from 'react-router-dom';
import { GoldenRegressionRunConsole } from '@/components/admin/pdfImport/GoldenRegressionRunConsole';

export default function PdfGoldenRegression() {
  const [params] = useSearchParams();
  const corpusId = params.get('corpusId');
  const importId = params.get('importId');
  const templateId = params.get('templateId');

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">PDF Golden Regression</h1>
        <p className="text-sm text-muted-foreground">
          Run golden corpus evaluation and persistence for existing PDF imports.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Related runbooks: <code>docs/pdf-import/runbooks/pdf-import-evaluate-only-sop.md</code>,{' '}
          <code>pdf-import-evaluate-persist-sop.md</code>, <code>pdf-import-golden-regression-review-sop.md</code>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Final rollout checklist: <code>docs/pdf-import/phase-11-production-rollout-checklist.md</code>
        </p>
        <p className="mt-1 text-xs">
          <Link
            to={importId ? `/admin/pdf-import-client-reports?importId=${encodeURIComponent(importId)}` : '/admin/pdf-import-client-reports'}
            className="text-primary underline underline-offset-2"
          >
            Create client-safe report
          </Link>
        </p>
      </div>
      <GoldenRegressionRunConsole
        initialCorpusId={corpusId}
        initialImportId={importId}
        initialTemplateId={templateId}
      />
    </div>
  );
}
