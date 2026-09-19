/**
 * AlignmentGrid — 9-cell page-anchor picker. Snaps the selected overlay to
 * one of nine canonical positions (corners, edge-centers, center) of the
 * page's content area (page size minus optional safe area).
 *
 * Pure UI — emits the next `{x, y}` for the overlay. Does NOT change w/h.
 */
import { Label } from '@/components/ui/label';

interface Props {
  pageWidth: number;
  pageHeight: number;
  overlayWidth: number;
  overlayHeight: number;
  safeArea?: number;
  onAlign: (xy: { x: number; y: number }) => void;
}

const CELLS: Array<[number, number, string]> = [
  [0, 0, '⌜'], [0.5, 0, '⎯'], [1, 0, '⌝'],
  [0, 0.5, '|'], [0.5, 0.5, '·'], [1, 0.5, '|'],
  [0, 1, '⌞'], [0.5, 1, '⎯'], [1, 1, '⌟'],
];

export function AlignmentGrid({ pageWidth, pageHeight, overlayWidth, overlayHeight, safeArea = 0, onAlign }: Props) {
  const left = safeArea;
  const top = safeArea;
  const right = pageWidth - safeArea;
  const bottom = pageHeight - safeArea;
  const innerW = Math.max(0, right - left);
  const innerH = Math.max(0, bottom - top);

  return (
    <div className="space-y-1.5">
      <Label className="text-[11px]">Snap to page</Label>
      <div className="grid w-fit grid-cols-3 gap-1 rounded-md border border-border bg-muted/20 p-1">
        {CELLS.map(([fx, fy, glyph], i) => (
          <button
            key={i}
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded border border-transparent bg-card text-xs text-muted-foreground hover:border-primary hover:text-primary"
            onClick={() => {
              const x = Math.round(left + (innerW - overlayWidth) * fx);
              const y = Math.round(top + (innerH - overlayHeight) * fy);
              onAlign({ x, y });
            }}
            title={`align ${fx},${fy}`}
          >
            {glyph}
          </button>
        ))}
      </div>
    </div>
  );
}
