/**
 * PDF Extraction V3 · E11 — page comparison viewer.
 *
 * Shows source / browser-final / export-final / diff evidence for the active page
 * via the lazy artifact hook. The signed URL is used only as an <img> src at
 * runtime and is never rendered as visible text. Distinguishes idle / loading /
 * ready / expired / missing / forbidden / error states with clear next steps.
 */
import { useEffect } from 'react';
import { ImageOff, Loader2, ShieldAlert, TimerReset } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ArtifactKind, PdfPageArtifactAvailabilityV1 } from '@/lib/reportTemplate/pdfImport/review';
import { availableArtifactKinds } from '@/lib/reportTemplate/pdfImport/review';
import type { UsePdfReviewArtifacts } from './usePdfReviewArtifacts';

const KIND_LABEL: Record<ArtifactKind, string> = {
  source: 'Source', 'browser-final': 'Browser', 'export-final': 'Export', diff: 'Diff',
  'foreground-source': 'Foreground (src)', 'foreground-output': 'Foreground (out)',
  'edge-source': 'Edges (src)', 'edge-output': 'Edges (out)',
  'region-source': 'Region (src)', 'region-output': 'Region (out)',
};

const KIND_TESTID: Partial<Record<ArtifactKind, string>> = {
  source: 'pdf-review-source-view', 'browser-final': 'pdf-review-browser-view',
  'export-final': 'pdf-review-export-view', diff: 'pdf-review-diff-view',
};

interface Props {
  pageNumber: number;
  availability: PdfPageArtifactAvailabilityV1;
  artifacts: UsePdfReviewArtifacts;
  selectedKind: ArtifactKind;
  onSelectKind: (kind: ArtifactKind) => void;
  finalOutputMode?: boolean;
}

export function PdfComparisonViewer({ pageNumber, availability, artifacts, selectedKind, onSelectKind, finalOutputMode }: Props) {
  const kinds = availableArtifactKinds(availability, { finalOutputMode });
  const active = kinds.includes(selectedKind) ? selectedKind : (kinds[0] ?? 'source');
  const entry = artifacts.get(pageNumber, active);

  useEffect(() => {
    if (kinds.includes(active)) artifacts.request(pageNumber, active);
  }, [pageNumber, active, artifacts, kinds]);

  return (
    <div className="flex h-full flex-col gap-2" data-testid={KIND_TESTID[active] ?? 'pdf-review-comparison'}>
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Evidence layer">
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={active === kind}
            onClick={() => onSelectKind(kind)}
            data-testid={KIND_TESTID[kind]}
            className={cn(
              'rounded border px-2 py-0.5 text-[11px] transition-colors',
              active === kind ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {KIND_LABEL[kind]}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded border bg-muted/20">
        <ArtifactSurface state={entry.state} url={entry.url} kind={active} pageNumber={pageNumber} />
      </div>
    </div>
  );
}

function ArtifactSurface({ state, url, kind, pageNumber }: { state: string; url: string | null; kind: ArtifactKind; pageNumber: number }) {
  if (state === 'ready' && url) {
    // The signed URL is only ever an <img> src at runtime — never shown as text.
    return <img src={url} alt={`${KIND_LABEL[kind]} artifact for page ${pageNumber}`} className="max-h-full max-w-full object-contain" />;
  }
  if (state === 'loading' || state === 'idle') {
    return <Placeholder icon={<Loader2 className="h-5 w-5 animate-spin" aria-hidden />} text="Loading artifact…" />;
  }
  if (state === 'expired') {
    return <Placeholder icon={<TimerReset className="h-5 w-5" aria-hidden />} text="Signed access expired. Refreshing artifact access." />;
  }
  if (state === 'forbidden') {
    return <Placeholder icon={<ShieldAlert className="h-5 w-5" aria-hidden />} text="Not authorized to view this artifact." />;
  }
  if (state === 'missing') {
    return <Placeholder icon={<ImageOff className="h-5 w-5" aria-hidden />} text="This artifact was not generated for this import." />;
  }
  if (state === 'invalid') {
    return <Placeholder icon={<ImageOff className="h-5 w-5" aria-hidden />} text="Artifact reference is invalid." />;
  }
  return <Placeholder icon={<ImageOff className="h-5 w-5" aria-hidden />} text="Could not load this artifact. Retry from the layer selector." />;
}

function Placeholder({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 p-6 text-center text-xs text-muted-foreground" role="status">
      {icon}
      <span>{text}</span>
    </div>
  );
}
