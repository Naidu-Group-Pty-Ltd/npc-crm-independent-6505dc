/**
 * A template's face, at choosing size.
 *
 * The picker's whole argument is that a design is chosen by LOOKING at it —
 * "Sovereign Folio" and "Signal Dark" are names nobody can rank without seeing
 * them — so every choice in the dialog leads with the document itself: the
 * real first page, rendered by `TemplateDocumentPreview` through the same
 * `renderTemplateToHtml` the customer's PDF goes through, with sample data
 * filled in. This component is the sheet-on-a-light-table treatment the
 * Template Library's browse cards established, at tile size: a soft pool of
 * light behind the paper so a white page and a near-black cover sit on the
 * same surface, and stacked page edges behind multi-page documents so a
 * two-page snapshot and a ten-page dossier read differently before either is
 * opened.
 *
 * A choice with no schema to draw still gets a sheet — an empty A4 with the
 * words on it — because in a gallery a missing preview must read as "this one
 * has no picture", never as a broken tile or a smaller kind of choice.
 */
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TemplateDocumentPreview } from '@/components/templateLibrary/TemplateDocumentPreview';
import type { Tokens } from '@/lib/reportTemplate/templateSchema';

interface Props {
  /** Page-one schema (`preview_schema`, or `{ pages: [page1], tokens }`). Null draws the empty sheet. */
  schema: unknown | null;
  /** Announced to assistive technology in place of the drawing. */
  label: string;
  /** Colourway repaint, exactly as the Library card applies it. */
  tokenOverrides?: Partial<Tokens>;
  /** Draws the stacked page edges behind the sheet. */
  pageCount?: number;
  className?: string;
}

export function ReportTemplateSheet({
  schema, label, tokenOverrides, pageCount = 1, className,
}: Props) {
  return (
    <span
      className={cn(
        'relative block w-full overflow-hidden rounded-md px-3 pb-4 pt-3',
        // The light table: template palettes are content, so the ground behind
        // them stays neutral and theme-correct.
        'bg-[radial-gradient(120%_80%_at_50%_0%,hsl(var(--muted)/0.55),transparent_75%)]',
        className,
      )}
    >
      <span className="relative block w-full">
        {pageCount > 1 && (
          <span
            aria-hidden="true"
            className="absolute inset-x-1.5 -bottom-1 top-1 rounded-[2px] bg-foreground/15 shadow-sm"
          />
        )}
        {pageCount > 3 && (
          <span
            aria-hidden="true"
            className="absolute inset-x-3 -bottom-[7px] top-2 rounded-[2px] bg-foreground/10"
          />
        )}
        <span className="relative block w-full overflow-hidden rounded-[2px] ring-1 ring-black/10 shadow-[0_1px_4px_rgba(0,0,0,0.14),0_10px_24px_-10px_rgba(0,0,0,0.4)]">
          {schema ? (
            <TemplateDocumentPreview
              schema={schema}
              variant="page"
              lazy
              tokenOverrides={tokenOverrides}
              label={label}
              className="w-full"
            />
          ) : (
            <span
              role="img"
              aria-label={label}
              className="flex aspect-[1/1.414] w-full flex-col items-center justify-center gap-1.5 bg-card text-muted-foreground"
            >
              <FileText className="h-5 w-5 opacity-50" aria-hidden="true" />
              <span className="text-[10px]">No preview</span>
            </span>
          )}
        </span>
      </span>
    </span>
  );
}
