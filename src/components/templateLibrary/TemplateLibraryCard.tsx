/**
 * One template in the browse grid.
 *
 * ## The design position
 *
 * The template *is* the product, so the document gets the space and everything
 * else gets out of its way. The card presents a real rendered first page as a
 * sheet of paper on a dark surface — a light table — because these are printed
 * client deliverables and that is what they look like in the world. Metadata is
 * deliberately quiet: two lines and a thin row of facts under the sheet.
 *
 * The earlier version led with badges and gave the document a 180px box. That
 * reads as a settings panel, not a catalogue. Here the sheet is the largest
 * thing on the card and the only thing with colour of its own.
 *
 * Compatibility stays honest and visible: only the investment report family has
 * a production adapter, so most templates can be copied and edited but not
 * activated for live generation. Saying so on the card beats letting a user find
 * out after an afternoon of edits.
 */
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Eye, FileStack, Plus, ShieldCheck, TriangleAlert } from 'lucide-react';
import { TemplateDocumentPreview } from './TemplateDocumentPreview';
import { ColourwaySwatch } from './TemplateColourwayPicker';
import { categoryLabel, reportTypeLabel } from '@/lib/templateLibrary/taxonomy';
import {
  axisLabel, colourwayOverridesFor, densityLabel, effectiveGround, entryColourways,
} from '@/lib/templateLibrary/entryDesign';
import type { TemplateLibraryListEntry } from '@/lib/templateLibrary/types';

interface Props {
  entry: TemplateLibraryListEntry;
  canUse: boolean;
  /** Colourway to draw the card's page-one in. Null uses the entry's default. */
  colourwayId?: string | null;
  onPreview: (entry: TemplateLibraryListEntry) => void;
  onUse: (entry: TemplateLibraryListEntry, colourwayId: string | null) => void;
  /** Selecting a swatch on the card. */
  onColourway?: (entry: TemplateLibraryListEntry, colourwayId: string) => void;
}

export function TemplateLibraryCard({
  entry, canUse, colourwayId = null, onPreview, onUse, onColourway,
}: Props) {
  const compat = entry.compatibility;
  const premium = entry.accessTier !== 'standard';
  const design = entry.designMeta;
  const colourways = entryColourways(entry);
  // The stored page-one already carries the entry's default colourway, so an
  // override is only computed when the user has chosen a different one.
  const tokenOverrides = colourwayOverridesFor(entry, colourwayId);
  const ground = effectiveGround(entry, colourwayId);

  return (
    <article
      className={[
        'group relative flex flex-col overflow-hidden rounded-xl border bg-card',
        'transition-[transform,box-shadow,border-color] duration-300 ease-out',
        'hover:-translate-y-1 hover:shadow-xl focus-within:-translate-y-1 focus-within:shadow-xl',
        'motion-reduce:transform-none motion-reduce:transition-none',
        premium ? 'border-primary/25 hover:border-primary/50' : 'border-border hover:border-primary/30',
      ].join(' ')}
    >
      {/* ── The sheet ───────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => onPreview(entry)}
        aria-label={`Preview ${entry.name}`}
        className={[
          'relative block w-full overflow-hidden px-6 pb-8 pt-6 text-left',
          // The light table: a soft pool of light behind the paper, so a white
          // page and a near-black cover both sit on the same surface.
          'bg-[radial-gradient(120%_80%_at_50%_0%,hsl(var(--muted)/0.55),transparent_70%)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        ].join(' ')}
      >
        {/* The whole of page one, never a crop. Nine of these templates open on
            a cover whose title sits at the optical centre of the sheet, so a
            top-crop showed an empty rectangle for exactly the templates whose
            covers are their strongest asset.

            Behind it, the edges of the pages underneath. It reads as a
            multi-page document at a glance — which a single sheet never does —
            and it is drawn from `pageCount`, so a two-page snapshot and a
            ten-page dossier look different before either is opened. */}
        <div className="relative mx-auto w-full">
          {entry.pageCount > 1 && (
            <span
              aria-hidden="true"
              className="absolute inset-x-2 -bottom-1 top-1.5 rounded-[2px] bg-foreground/15 shadow-sm"
            />
          )}
          {entry.pageCount > 3 && (
            <span
              aria-hidden="true"
              className="absolute inset-x-4 -bottom-2 top-3 rounded-[2px] bg-foreground/10"
            />
          )}
          <div
            className={[
              'relative w-full overflow-hidden rounded-[2px] ring-1 ring-black/10',
              'shadow-[0_2px_6px_rgba(0,0,0,0.16),0_18px_40px_-12px_rgba(0,0,0,0.45)]',
              'transition-transform duration-300 ease-out group-hover:scale-[1.015]',
              'motion-reduce:transform-none motion-reduce:transition-none',
            ].join(' ')}
          >
            <TemplateDocumentPreview
              schema={entry.previewSchema}
              variant="page"
              lazy
              tokenOverrides={tokenOverrides}
              label={`First page of ${entry.name}, rendered with sample data`}
              className="w-full"
            />
          </div>
        </div>

        {/* Hover affordance — names the action rather than just dimming. */}
        <span
          className={[
            'pointer-events-none absolute inset-0 flex items-center justify-center',
            'bg-background/45 backdrop-blur-[1px]',
            'opacity-0 transition-opacity duration-200',
            'group-hover:opacity-100 group-focus-within:opacity-100',
            'motion-reduce:transition-none',
          ].join(' ')}
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-1.5 text-xs font-medium shadow-lg">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            Read full template
          </span>
        </span>

        {premium && (
          <span className="absolute right-4 top-4 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary backdrop-blur">
            {entry.accessTier}
          </span>
        )}
      </button>

      {/* ── Identity ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-3 border-t border-border/60 p-5">
        <div>
          {/* The family, above the name. A catalogue of fifty masters across ten
              families is unreadable if the only label is the template's own
              name — "Bullion Rail" means nothing without "Private Banking". */}
          {design && (
            <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
              {design.familyName}
            </p>
          )}
          <h3 className="text-[15px] font-semibold leading-snug tracking-[-0.01em]">{entry.name}</h3>
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
            {entry.description || 'No description'}
          </p>
        </div>

        {/* One quiet line of facts, separated by hairlines rather than chips. */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/80">{categoryLabel(entry.category)}</span>
          {entry.reportType && (
            <>
              <span aria-hidden="true" className="text-border">·</span>
              <span>{reportTypeLabel(entry.reportType)}</span>
            </>
          )}
          <span aria-hidden="true" className="text-border">·</span>
          <span className="inline-flex items-center gap-1">
            <FileStack className="h-3 w-3" aria-hidden="true" />
            {entry.pageCount} page{entry.pageCount === 1 ? '' : 's'}
          </span>
          {design && (
            <>
              <span aria-hidden="true" className="text-border">·</span>
              <span className="capitalize">{axisLabel(design.variantAxis)}</span>
              <span aria-hidden="true" className="text-border">·</span>
              <span>{densityLabel(design.density)}</span>
              <span aria-hidden="true" className="text-border">·</span>
              <span>{ground === 'dark' ? 'Dark' : 'Light'}</span>
            </>
          )}
        </div>

        {design && (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            <span className="text-foreground/70">For:</span> {design.recommendedUse}
          </p>
        )}

        {/* The ten colourways, as the catalogue itself presents them: paper
            behind, accent in front. Selecting one repaints the sheet above
            rather than opening anything. */}
        {colourways.length > 0 && (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Colourways for ${entry.name}`}>
            {colourways.map((c) => {
              const active = (colourwayId ?? design?.defaultColourway) === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onColourway?.(entry, c.id)}
                  title={`${c.name} · ${c.ground}`}
                  aria-label={`${c.name}, ${c.ground} ground`}
                  aria-pressed={active}
                  className={[
                    'rounded-[2px] p-[1.5px] transition-shadow',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'ring-2 ring-foreground' : 'ring-1 ring-border hover:ring-foreground/40',
                  ].join(' ')}
                >
                  <ColourwaySwatch colourway={c} size={13} />
                </button>
              );
            })}
          </div>
        )}

        <TooltipProvider>
          <div className="flex flex-wrap gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Badge does not forward refs, so the trigger holds a span. */}
                <span tabIndex={0} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Badge
                    variant="outline"
                    className={
                      compat.productionReady
                        ? 'gap-1 border-success/40 text-success'
                        : 'gap-1 border-warning/40 text-warning'
                    }
                  >
                    {compat.productionReady
                      ? <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                      : <TriangleAlert className="h-3 w-3" aria-hidden="true" />}
                    {compat.productionReady ? 'Report-ready' : 'Preview only'}
                  </Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {compat.productionReady
                  ? 'This report type has a production adapter, and every block renders in the production pipeline. A copy can be approved and activated for live reports.'
                  : 'A copy can be created and edited, but this report type has no production adapter yet, so it cannot be activated for live report generation.'}
              </TooltipContent>
            </Tooltip>

            {compat.brandSafe && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Badge variant="outline" className="gap-1">White-label ready</Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Every colour is a brand token, so a partner palette applies in full.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </TooltipProvider>

        <div className="mt-auto flex gap-2 pt-1">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => onPreview(entry)}>
            <Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Preview
          </Button>
          {canUse && (
            <Button size="sm" className="flex-1" onClick={() => onUse(entry, colourwayId)}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Use template
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
