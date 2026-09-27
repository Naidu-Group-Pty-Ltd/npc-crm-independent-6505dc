/**
 * A chosen template, sent to a report's own route as the design to draw in.
 *
 * ## What this is for
 *
 * Nine report types are held on their standard documents
 * (`templateParity.pure.ts`): a master's pages are a second statement of what
 * a report says, and on 26 Sep 2026 none of the nine said the same thing
 * through a template as through its standard document. So for those nine a
 * chosen template no longer supplies pages. It supplies the DESIGN — the
 * typefaces, the colourway, the cover's ground, how tables and section
 * headings are ruled — and the report's own route draws every page in it
 * (`templateDesign.pure.ts`). Whatever is chosen, the words, the figures and
 * the pages are the standard document's, by construction.
 *
 * This is the browser's half: which design to ask for, and what to say about
 * the answer.
 *
 * ## Asked where the route is called
 *
 * Every path to one of those routes — a download, an email attachment, a
 * portal publish — goes through one `request*` function per format, and each
 * of them asks here. So a choice is honoured wherever a document is produced,
 * which is what the chooser says happens. A caller that has already read the
 * choice passes it, and nothing is read twice: the Cash Flow modal files a
 * finished document under a key that includes the design, and the key and the
 * render have to be the same reading.
 *
 * ## A choice that was not honoured is said out loud
 *
 * The route answers with what it drew (`DesignEcho`). A refusal comes with a
 * sentence the person can act on, and it is shown as it came. A route that
 * says NOTHING about a design it was sent is a deployment older than designs:
 * that is said too, because a standard document handed over in silence would
 * look exactly like a chosen design that was honoured. Either way the
 * document is delivered — a design is never worth the document.
 */
import { toast } from 'sonner';
import type {
  DesignEcho,
  TemplateDesignRefusal,
} from '../../../supabase/functions/_shared/reportDesign/templateDesign.pure.ts';
import { designLenderFor } from '../../../supabase/functions/_shared/reports/templateDesignRoute.pure.ts';
import { isTemplateDeliveryHeld } from '../../../supabase/functions/_shared/reports/templateParity.pure.ts';
import { fetchTemplateSelections, normaliseReportType, selectionsByFormat } from './templateSelection';

/**
 * What a route is asked to draw in: a `report_templates` row, or a catalogue
 * design in one of its colourways. The shape `readTemplateDesignReference`
 * accepts on the server.
 */
export type StandardDesignRequest =
  | { templateId: string }
  | { code: string; colourway?: string | null };

/**
 * The design to send, or null for the standard design.
 *
 * `explicit` wins when given, `null` included — that is how a caller says "I
 * read the choice already" or "the standard design, whatever was chosen".
 * Otherwise the person's own choice for the format is read, for a held report
 * type only: a released type draws its chosen template through the template's
 * own pages (`tryTemplateDocument`), and asking its route for the design as
 * well would describe one choice twice.
 *
 * A failed read answers null. The standard design is what this format
 * produced before designs existed, so the fall-back is the document everyone
 * already had.
 */
export async function standardDesignFor(
  reportType: string,
  explicit?: StandardDesignRequest | null,
): Promise<StandardDesignRequest | null> {
  if (explicit !== undefined) return explicit;
  if (!isTemplateDeliveryHeld(reportType)) return null;
  try {
    const byFormat = selectionsByFormat(await fetchTemplateSelections());
    const own = byFormat.get(normaliseReportType(reportType))?.template_id;
    // A format with no templates of its own wears the design chosen for the
    // report it is made from (`DESIGN_BORROWED_FROM`); its own choice wins.
    const lender = designLenderFor(reportType);
    const templateId = own ?? (lender ? byFormat.get(lender)?.template_id : undefined);
    return templateId ? { templateId } : null;
  } catch {
    return null;
  }
}

/** The body fragment a request spreads in: nothing at all when no design is sent. */
export function designBody(design: StandardDesignRequest | null): { design?: StandardDesignRequest } {
  return design ? { design } : {};
}

const REFUSALS: readonly TemplateDesignRefusal[] = [
  'unknown_design', 'palette_incomplete', 'palette_illegible', 'template_unavailable', 'template_unreadable',
];

/** The route's answer about a design, read defensively: it crossed a network. */
export function readDesignEcho(raw: unknown): DesignEcho | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const a = r.applied && typeof r.applied === 'object' ? r.applied as Record<string, unknown> : null;
  const applied = a
    ? {
      label: String(a.label ?? ''),
      code: typeof a.code === 'string' && a.code ? a.code : null,
      colourway: typeof a.colourway === 'string' && a.colourway ? a.colourway : null,
    }
    : null;
  const refusal = REFUSALS.find((reason) => reason === r.refusal) ?? null;
  if (!applied && !refusal) return null;
  return { applied, refusal, message: typeof r.message === 'string' && r.message ? r.message : null };
}

/**
 * What became of the design a request sent.
 *
 * - `none` — no design was sent; the standard design was asked for.
 * - `applied` — the document is in the design.
 * - `refused` — the route drew the standard design and said why.
 * - `unanswered` — the route said nothing about the design it was sent (a
 *   deployment older than designs), or no route drew the document at all.
 */
export type DesignOutcome = 'none' | 'applied' | 'refused' | 'unanswered';

export function designOutcome(asked: StandardDesignRequest | null, raw: unknown): DesignOutcome {
  if (!asked) return 'none';
  const echo = readDesignEcho(raw);
  if (!echo) return 'unanswered';
  return echo.applied ? 'applied' : 'refused';
}

/** The title every "not honoured" notice shares, so they read as one fact. */
export const DESIGN_NOT_USED_TITLE = 'Your chosen template was not used for this document';

/** Said when a route answers without a word about the design it was sent. */
export const DESIGN_UNANSWERED_TEXT =
  'The report service that drew it does not apply chosen templates yet, so it uses the standard '
  + 'design. Generate it again once the service has been updated.';

/** Said when no route drew the document — the in-browser generator stood in. */
export const DESIGN_NOT_DRAWN_TEXT =
  'It was produced in the browser while the report service was unavailable, so it uses the '
  + 'standard design.';

/**
 * Tell the person what became of their design, once, beside a working file.
 *
 * An applied design needs no words: the document is what they chose. Returns
 * the outcome for the caller that keys something on it.
 */
export function announceDesignOutcome(
  asked: StandardDesignRequest | null,
  raw: unknown,
  opts: { drawnWithoutRoute?: boolean } = {},
): DesignOutcome {
  if (!asked) return 'none';
  if (opts.drawnWithoutRoute) {
    toast.warning(DESIGN_NOT_USED_TITLE, { description: DESIGN_NOT_DRAWN_TEXT, duration: 12_000 });
    return 'unanswered';
  }
  const outcome = designOutcome(asked, raw);
  if (outcome === 'refused') {
    const echo = readDesignEcho(raw)!;
    toast.warning(DESIGN_NOT_USED_TITLE, {
      description: echo.message ?? 'The standard design was used.',
      duration: 12_000,
    });
  } else if (outcome === 'unanswered') {
    toast.warning(DESIGN_NOT_USED_TITLE, { description: DESIGN_UNANSWERED_TEXT, duration: 12_000 });
  }
  return outcome;
}
