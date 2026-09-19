/**
 * CanvasChrome — Phase 2 overlay that wraps the tldraw canvas with
 * print-publishing furniture:
 *   • Horizontal + vertical rulers (pt-based, scaled to page width)
 *   • Optional grid overlay (configurable cell size)
 *   • Bleed line (red, outside trim)
 *   • Safe-area line (cyan, inside trim)
 *   • Floating toolbar with zoom %, snap-to-grid, grid/rulers/bleed toggles
 *
 * It is purely visual — drags/edits still happen in tldraw. The page
 * dimensions are used to position the rulers/lines as a percentage of the
 * tldraw zoom-to-fit viewport, so it stays roughly aligned at fit zoom.
 * For exact rendering, designers should rely on the inspector x/y values.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Input } from '@/components/ui/input';
import { Grid3x3, Ruler as RulerIcon, Crop, Shield, Magnet, AlignJustify } from 'lucide-react';
import { toRendererHex } from '@/lib/reportTemplate/cssColor';
import type { Page, ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface Props {
  page: Page;
  canvas: NonNullable<ReportTemplate['canvas']>;
  onChangeCanvas: (next: NonNullable<ReportTemplate['canvas']>) => void;
}

const RULER_SIZE = 18; // px

export function CanvasChrome({ page, canvas, onChangeCanvas }: Props) {
  const [zoomLabel] = useState('Fit');
  const w = page.size?.width ?? 595;
  const h = page.size?.height ?? 842;
  const bleed = page.bleed ?? 0;
  const safe = page.safeArea ?? 0;
  const baselineGridColor = toRendererHex(page.baselineGrid?.color) ?? '#BF9B504D';

  return (
    <>
      {/* Rulers */}
      {canvas.showRulers && (
        <>
          <div
            className="pointer-events-none absolute top-0 z-10 border-b border-border bg-background/80 backdrop-blur"
            style={{ left: RULER_SIZE, right: 0, height: RULER_SIZE }}
          >
            <Ticks length={w} orientation="h" />
          </div>
          <div
            className="pointer-events-none absolute left-0 z-10 border-r border-border bg-background/80 backdrop-blur"
            style={{ top: RULER_SIZE, bottom: 0, width: RULER_SIZE }}
          >
            <Ticks length={h} orientation="v" />
          </div>
          <div
            className="pointer-events-none absolute top-0 left-0 z-10 border-r border-b border-border bg-background/90"
            style={{ width: RULER_SIZE, height: RULER_SIZE }}
          />
        </>
      )}

      {/* Grid overlay (positioned over the tldraw page-bg roughly) */}
      {canvas.showGrid && (
        <div
          className="pointer-events-none absolute inset-0 z-[5] opacity-[0.18]"
          style={{
            backgroundImage:
              'linear-gradient(to right, hsl(var(--primary)) 1px, transparent 1px),' +
              'linear-gradient(to bottom, hsl(var(--primary)) 1px, transparent 1px)',
            backgroundSize: `${canvas.gridSize}px ${canvas.gridSize}px`,
          }}
        />
      )}

      {/* Baseline grid overlay (Phase 5) */}
      {canvas.showBaselineGrid && page.baselineGrid?.size && (
        <div
          className="pointer-events-none absolute inset-0 z-[6]"
          style={{
            backgroundImage:
              `repeating-linear-gradient(to bottom, transparent 0, transparent ${(page.baselineGrid.size) - 1}px, ${baselineGridColor} ${(page.baselineGrid.size) - 1}px, ${baselineGridColor} ${page.baselineGrid.size}px)`,
            backgroundPosition: `0 ${page.baselineGrid.offset ?? 0}px`,
          }}
        />
      )}

      {/* Floating toolbar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-md border border-border bg-background/95 backdrop-blur px-2 py-1 shadow-md">
        <span className="text-[10px] text-muted-foreground px-1 font-mono">{w}×{h}pt</span>
        <span className="text-[10px] text-muted-foreground px-1 font-mono border-l border-border ml-1 pl-2">{zoomLabel}</span>
        <div className="border-l border-border mx-1 h-5" />

        <Toggle
          size="sm"
          pressed={canvas.showRulers}
          onPressedChange={(v) => onChangeCanvas({ ...canvas, showRulers: v })}
          title="Rulers"
        >
          <RulerIcon className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={canvas.showGrid}
          onPressedChange={(v) => onChangeCanvas({ ...canvas, showGrid: v })}
          title="Grid"
        >
          <Grid3x3 className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={canvas.snapToGrid}
          onPressedChange={(v) => onChangeCanvas({ ...canvas, snapToGrid: v })}
          title="Snap to grid"
        >
          <Magnet className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={canvas.showBleed}
          onPressedChange={(v) => onChangeCanvas({ ...canvas, showBleed: v })}
          title="Bleed"
        >
          <Crop className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={canvas.showSafeArea}
          onPressedChange={(v) => onChangeCanvas({ ...canvas, showSafeArea: v })}
          title="Safe area"
        >
          <Shield className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={!!canvas.showBaselineGrid}
          onPressedChange={(v) => onChangeCanvas({ ...canvas, showBaselineGrid: v })}
          title="Baseline grid"
        >
          <AlignJustify className="h-3.5 w-3.5" />
        </Toggle>

        <div className="border-l border-border mx-1 h-5" />
        <span className="text-[10px] text-muted-foreground">Grid</span>
        <Input
          type="number"
          className="h-6 w-12 text-[10px] px-1"
          value={canvas.gridSize}
          min={2}
          max={64}
          onChange={(e) => onChangeCanvas({ ...canvas, gridSize: Number(e.target.value) || 8 })}
        />

        {(canvas.showBleed || canvas.showSafeArea) && (
          <span className="text-[10px] text-muted-foreground border-l border-border pl-2 ml-1">
            Bleed {bleed}pt · Safe {safe}pt
          </span>
        )}
      </div>
    </>
  );
}

function Ticks({ length, orientation }: { length: number; orientation: 'h' | 'v' }) {
  // emit ticks every 50pt with labels
  const ticks: number[] = [];
  for (let i = 0; i <= length; i += 50) ticks.push(i);
  return (
    <div className="relative w-full h-full text-[8px] text-muted-foreground font-mono">
      {ticks.map((t) => {
        const pct = (t / length) * 100;
        const style = orientation === 'h'
          ? { left: `${pct}%`, top: 0, bottom: 0 }
          : { top: `${pct}%`, left: 0, right: 0 };
        return (
          <div key={t} className="absolute" style={style}>
            <div
              className={orientation === 'h' ? 'h-2 w-px bg-border absolute bottom-0' : 'w-2 h-px bg-border absolute right-0'}
            />
            <span
              className={orientation === 'h' ? 'absolute left-1 -top-px' : 'absolute top-1 -left-px'}
            >
              {t}
            </span>
          </div>
        );
      })}
    </div>
  );
}
