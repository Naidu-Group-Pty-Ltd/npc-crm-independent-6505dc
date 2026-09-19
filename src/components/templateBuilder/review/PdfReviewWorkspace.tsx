/**
 * PDF Extraction V3 · E11 — Review Workspace shell (pdf-review-workspace-v1).
 *
 * Composes the document overview, the virtualized page navigator, the comparison
 * viewer and the page inspector into one coherent, responsive review surface. It
 * is a controlled presentational shell: all data comes from the pure document
 * review model, artifacts are hydrated lazily and runtime-only, and every mutating
 * action is delegated upward (never performed here). Answers "why does this page
 * look like this?" within one or two interactions.
 */
import { useMemo, useState } from 'react';
import type { ArtifactKind, PdfDocumentReviewModelV1 } from '@/lib/reportTemplate/pdfImport/review';
import { buildPageReviewModel } from '@/lib/reportTemplate/pdfImport/review';
import type { PageAuthorityInput } from '@/lib/reportTemplate/pdfImport/review/buildPageReviewModel';
import { PdfDocumentOverview } from './PdfDocumentOverview';
import { PdfPageNavigator } from './PdfPageNavigator';
import { PdfComparisonViewer } from './PdfComparisonViewer';
import { PdfPageInspector } from './PdfPageInspector';
import { usePdfReviewArtifacts, type ArtifactSigner } from './usePdfReviewArtifacts';

interface Props {
  model: PdfDocumentReviewModelV1;
  /** Raw per-page authority inputs, so the workspace can build the active page detail lazily. */
  pageInputs: PageAuthorityInput[];
  /** Injected authenticated signer (never a hardcoded endpoint). */
  signArtifact: ArtifactSigner;
}

export function PdfReviewWorkspace({ model, pageInputs, signArtifact }: Props) {
  const firstPage = model.pageSummaries[0]?.pageNumber ?? null;
  const [selectedPage, setSelectedPage] = useState<number | null>(firstPage);
  const [selectedKind, setSelectedKind] = useState<ArtifactKind>('source');
  const artifacts = usePdfReviewArtifacts({ importId: model.importId, signArtifact });

  const activePageModel = useMemo(() => {
    if (selectedPage == null) return null;
    const input = pageInputs.find((p) => p.pageNumber === selectedPage);
    return input ? buildPageReviewModel(input) : null;
  }, [selectedPage, pageInputs]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="pdf-review-workspace" data-version="pdf-review-workspace-v1">
      <PdfDocumentOverview model={model} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(180px,240px)_1fr_minmax(240px,320px)]">
        <div className="min-h-0 md:border-r md:pr-3">
          <PdfPageNavigator
            pages={model.pageSummaries}
            selectedPageNumber={selectedPage}
            onSelect={setSelectedPage}
          />
        </div>
        <div className="min-h-0">
          {activePageModel ? (
            <PdfComparisonViewer
              pageNumber={activePageModel.pageNumber}
              availability={activePageModel.artifacts}
              artifacts={artifacts}
              selectedKind={selectedKind}
              onSelectKind={setSelectedKind}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Select a page to review.</div>
          )}
        </div>
        <div className="min-h-0 md:border-l md:pl-3">
          {activePageModel ? (
            <PdfPageInspector page={activePageModel} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No page selected.</div>
          )}
        </div>
      </div>
    </div>
  );
}
