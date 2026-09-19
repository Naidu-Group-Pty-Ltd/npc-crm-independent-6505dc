/**
 * One specimen card, rendered the way the document will be.
 *
 * ## Why an iframe
 *
 * The alternative is re-implementing the report design system in React and
 * Tailwind, which would be lighter, easier to style, and a second copy of a
 * thing this codebase has repeatedly found drifting from the first. What goes
 * into this iframe is `buildReportCss` plus the real primitives — the same
 * stylesheet and the same markup WeasyPrint gets — so a card cannot show
 * something the PDF will not.
 *
 * An iframe is also the only honest way to do it. The report stylesheet sets
 * `html, body` background and colour, declares `@page` rules and sizes
 * everything in points; dropped into the app's DOM it would either fight the
 * app's styles or be neutered by them. A document deserves its own document.
 *
 * ## Sandboxed, with nothing granted
 *
 * `sandbox=""` — no scripts, no forms, no same-origin, no top navigation. The
 * HTML here is ours, but a specimen renders an *imported* design system's
 * values and a token file is something a person dropped onto the page, so the
 * frame gets no capabilities at all. `srcDoc` rather than a blob URL keeps it
 * out of the origin entirely.
 *
 * ## Scaling
 *
 * Each specimen declares a viewport in its own coordinates — the cover is
 * 794×1123, which is A4 at 96dpi, so the proportions are the printed ones. The
 * frame is rendered at that size and CSS-scaled to whatever width the card
 * gets, which keeps the type metrics correct instead of reflowing them.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { Card } from '@/components/ui/card';
import { buildReportCss } from '@/lib/reportDesign/css.pure';
import { renderDocument } from '@/lib/reportDesign/primitives.pure';
import type { ReportDesignOptions } from '@/lib/reportDesign/options.pure';
import type { ResolvedReportPalette } from '@/lib/reportDesign/roles.pure';
import type { BrandSpecimen } from '@/lib/brandDesign/specimens';

export interface BrandSpecimenCardProps {
  specimen: BrandSpecimen;
  palette: ResolvedReportPalette;
  options: ReportDesignOptions;
  /** Printed in the running head, as it is on a real page. */
  masthead: string;
}

export function BrandSpecimenCard({
  specimen, palette, options, masthead,
}: BrandSpecimenCardProps) {
  const holder = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // The card's own width, watched rather than assumed: the gallery is a
  // responsive grid and a specimen scaled to a stale width is a specimen with a
  // scrollbar or a gap beside it.
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const srcDoc = useMemo(() => renderDocument({
    title: specimen.name,
    author: masthead,
    subject: specimen.subtitle,
    css: buildReportCss({ palette, options, masthead })
      // The specimen is a fragment of a document, not a document. Without this
      // the `@page` margins hold a 25mm gutter inside a 250px card and the
      // content is a stripe down the middle.
      + `\n  html, body { padding: 18px; }\n`
      + `  body > * + * { margin-top: 10px; }\n`,
    bodyHtml: specimen.body(palette, options),
  }), [specimen, palette, options, masthead]);

  const scale = width > 0 ? width / specimen.viewport.w : 1;
  const scaledHeight = Math.round(specimen.viewport.h * scale);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 border-b px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{specimen.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{specimen.subtitle}</p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {specimen.viewport.w}×{specimen.viewport.h}
        </span>
      </div>

      <div ref={holder} className="overflow-hidden bg-muted/30" style={{ height: scaledHeight || undefined }}>
        {width > 0 && (
          <iframe
            title={`${specimen.name} — specimen`}
            /* Nothing granted. The values inside come from a token file
               somebody dropped onto the page. */
            sandbox=""
            loading="lazy"
            srcDoc={srcDoc}
            className="border-0"
            style={{
              width: specimen.viewport.w,
              height: specimen.viewport.h,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          />
        )}
      </div>

      {/* The mono token line and the prose note, in that order — the two lines
          a card in the published design system carries beneath its specimen. */}
      <div className="space-y-1.5 border-t px-4 py-3">
        <p className="font-mono text-[10px] text-muted-foreground">{specimen.tokenLine(options)}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{specimen.note}</p>
      </div>
    </Card>
  );
}
