/**
 * A converted document, as an editable template.
 *
 * ## Why this has to lay out geometry by hand
 *
 * The editor's schema has no reflow. Every overlay carries an absolute `x`,
 * `y`, `width` and `height` in points on a fixed-size page, and there is no
 * linked-frame mechanism — one schema page is exactly one printed page
 * (`htmlRenderer` sets `page-break-after: always` on each). So prose that runs
 * longer than a page cannot simply be handed over; it has to be cut into
 * page-sized pieces by whoever builds the template.
 *
 * There is no existing helper that does this. `applyTemplateImportPlan`
 * transcribes a plan whose overlays are *already* positioned; the CDIR mapper
 * needs a real browser measuring pass; `chunkReportContent` produces binding
 * data with no geometry at all. So: this module.
 *
 * ## The pagination is borrowed, not invented
 *
 * `CHARS_PER_LINE` and `LINES_PER_PAGE` come from the same estimator the PDF
 * renderer uses (`_shared/reports/markdown.pure.ts`). Using them here means the
 * editable copy breaks its pages roughly where the PDF does, which is what
 * somebody comparing the two will expect. It is an estimate from a character
 * count, not a measurement — a page that runs a little long in the editor is
 * expected, and adjustable, and that is worth saying on the screen.
 *
 * ## Colours are token references, never values
 *
 * `BindableColorSchema` accepts `token:primary`, and the blank template already
 * opens with `background: { color: 'token:bg' }`. Writing the layout entirely
 * in token references means a converted template re-themes with everything
 * else — and means this module contributes no hardcoded colour to a repo whose
 * style ratchet counts them.
 */
/* eslint-disable no-restricted-syntax --
 * The `fontFamily` values here are `token:` references inside a *document*
 * schema, not per-component styling. They are resolved against the template's
 * own `tokens.fonts` by `resolveBindable` at render time, which is exactly the
 * indirection the rule exists to enforce — it simply cannot tell a PDF
 * template's type stack from a React component's.
 */
import { CHARS_PER_LINE, LINES_PER_PAGE } from '@/lib/reports/markdown.pure';
import { markdownToPlainText, stripHeadingNumbering } from './reportSections';
import {
  DEFAULT_BRAND_TOKENS,
  type Overlay,
  type Page,
  type ReportTemplate,
  ReportTemplateSchema,
} from './templateSchema';

/** A4 portrait, the size `makeBlankTemplate` opens with. */
export const PAGE_WIDTH = 595;
export const PAGE_HEIGHT = 842;

/** Generous enough to look composed, tight enough not to waste a page. */
export const MARGIN = 56;

/** The usable column. */
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const BODY_SIZE = 11;
const BODY_LEADING = 1.45;
const BODY_LINE_HEIGHT = BODY_SIZE * BODY_LEADING;

/** Lines of body copy one page holds, after its heading block. */
const LINES_AFTER_HEADING = LINES_PER_PAGE - 6;

/** How many characters of the source a single chapter may carry. */
const MAX_CHAPTER_CHARS = 20_000;

export interface ConvertedChapterInput {
  title: string;
  kind: 'bound' | 'unfilled' | 'appendix';
  markdown: string;
}

export interface BuildConvertedTemplateInput {
  /** The uploaded template's own title. */
  title: string;
  /** The report format it was bound to, in words. */
  formatName: string;
  chapters: readonly ConvertedChapterInput[];
  /** The design system it was set in, printed on the cover. */
  systemName?: string;
}

let seq = 0;
/**
 * Ids that are unique within one build and stable across builds.
 *
 * Not `crypto.randomUUID()`, deliberately: the same input should produce the
 * same template, so a test can assert on the whole object and a rebuild
 * produces no spurious diff.
 */
const nextId = (prefix: string) => `${prefix}-${(seq += 1).toString(36)}`;

function textOverlay(
  content: string,
  box: { x: number; y: number; width: number; height: number },
  style: Partial<Overlay> & Record<string, unknown> = {},
): Overlay {
  return {
    id: nextId('ov'),
    type: 'text',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: 0,
    opacity: 1,
    content,
    fontFamily: 'token:body',
    fontSize: BODY_SIZE,
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: 'token:text',
    align: 'left',
    lineHeight: BODY_LEADING,
    letterSpacing: 0,
    ...style,
  } as Overlay;
}

/** One page holding loose overlays. `free` is the canonical container. */
function freePage(name: string, overlays: Overlay[]): Page {
  return {
    id: nextId('pg'),
    name,
    size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    background: { color: 'token:bg' },
    blocks: [{ id: nextId('blk'), type: 'free', props: {}, overlays }],
  } as Page;
}

/**
 * Prose into page-sized chunks.
 *
 * Splits on paragraph boundaries and only falls back to cutting a paragraph
 * when a single one is longer than a page — a break mid-sentence is worse than
 * a slightly short page, and in a document somebody is about to edit it is also
 * confusing.
 */
export function paginateProse(text: string, linesPerPage: number): string[] {
  const paragraphs = String(text ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paragraphs.length) return [];

  const linesIn = (s: string) => Math.max(1, Math.ceil(s.length / CHARS_PER_LINE)) + 1;
  const pages: string[] = [];
  let current: string[] = [];
  let used = 0;

  const flush = () => {
    if (current.length) pages.push(current.join('\n\n'));
    current = [];
    used = 0;
  };

  for (const paragraph of paragraphs) {
    let remaining = paragraph;
    // A paragraph longer than a whole page is cut at a word boundary until what
    // is left fits. Rare, but a fee schedule pasted as one block does it.
    while (linesIn(remaining) > linesPerPage) {
      const budget = linesPerPage * CHARS_PER_LINE;
      const cut = remaining.lastIndexOf(' ', budget);
      const head = remaining.slice(0, cut > budget * 0.6 ? cut : budget).trim();
      flush();
      pages.push(head);
      remaining = remaining.slice(head.length).trim();
    }
    const needed = linesIn(remaining);
    if (used + needed > linesPerPage && current.length) flush();
    current.push(remaining);
    used += needed;
  }
  flush();
  return pages;
}

/**
 * Build the template.
 *
 * Returns a `ReportTemplate` already through the zod parser, so a caller can
 * hand it straight to the create mutation. A shape this module got wrong should
 * fail here, where the stack trace points at the builder, rather than inside
 * `manage-templates` where it points at a validator.
 */
export function buildConvertedTemplate(input: BuildConvertedTemplateInput): ReportTemplate {
  seq = 0;
  const pages: Page[] = [];

  // ── Cover ────────────────────────────────────────────────────────────────
  //
  // Says what the document is on the page itself. A converted draft looks
  // exactly like a finished one, and the PDF carries the same warning for the
  // same reason.
  pages.push(freePage('Cover', [
    textOverlay(
      `${input.formatName} · converted draft`.toUpperCase(),
      { x: MARGIN, y: MARGIN + 180, width: CONTENT_WIDTH, height: 20 },
      { fontSize: 9, letterSpacing: 2, color: 'token:primary', fontFamily: 'token:heading' },
    ),
    textOverlay(
      input.title || 'Converted template',
      { x: MARGIN, y: MARGIN + 210, width: CONTENT_WIDTH, height: 150 },
      { fontSize: 34, fontWeight: 'bold', lineHeight: 1.15, fontFamily: 'token:heading' },
    ),
    textOverlay(
      input.systemName
        ? `Set in ${input.systemName}. Converted from an existing template — the words are the `
          + 'ones that were uploaded, not live report data.'
        : 'Converted from an existing template — the words are the ones that were uploaded, '
          + 'not live report data.',
      { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 60, width: CONTENT_WIDTH, height: 44 },
      { fontSize: 9, color: 'token:muted' },
    ),
  ]));

  // ── Chapters ─────────────────────────────────────────────────────────────

  input.chapters.forEach((chapter, index) => {
    const number = String(index + 1).padStart(2, '0');
    const prose = markdownToPlainText(
      stripHeadingNumbering(String(chapter.markdown ?? '')).slice(0, MAX_CHAPTER_CHARS),
    );

    // An unfilled chapter has no prose by definition — the format prints it
    // from its own data. It still gets a page, because dropping it would change
    // the format's structure, which is the thing binding is for.
    const body = chapter.kind === 'unfilled'
      ? [
        'The report format prints this chapter from its own data. The uploaded template had '
        + 'nothing that matched it, so it is empty here and will fill itself when the format '
        + 'renders for real.',
      ]
      : paginateProse(prose, LINES_AFTER_HEADING);

    const chunks = body.length ? body : [''];

    chunks.forEach((chunk, part) => {
      const overlays: Overlay[] = [];
      let cursor = MARGIN;

      // The heading opens the chapter and repeats, quietly, on a continuation.
      if (part === 0) {
        overlays.push(textOverlay(
          `SECTION ${number}`,
          { x: MARGIN, y: cursor, width: CONTENT_WIDTH, height: 16 },
          { fontSize: 8, letterSpacing: 2, color: 'token:primary', fontFamily: 'token:heading' },
        ));
        cursor += 26;
        overlays.push(textOverlay(
          chapter.title,
          { x: MARGIN, y: cursor, width: CONTENT_WIDTH, height: 40 },
          { fontSize: 22, fontWeight: 'bold', lineHeight: 1.2, fontFamily: 'token:heading' },
        ));
        cursor += 56;
        if (chapter.kind === 'appendix') {
          overlays.push(textOverlay(
            'From the uploaded template — no chapter of the format matched this section.',
            { x: MARGIN, y: cursor, width: CONTENT_WIDTH, height: 16 },
            { fontSize: 9, fontStyle: 'italic', color: 'token:muted' },
          ));
          cursor += 24;
        }
      } else {
        overlays.push(textOverlay(
          `${chapter.title} (continued)`,
          { x: MARGIN, y: cursor, width: CONTENT_WIDTH, height: 18 },
          { fontSize: 10, fontStyle: 'italic', color: 'token:muted', fontFamily: 'token:heading' },
        ));
        cursor += 30;
      }

      if (chunk) {
        const lines = Math.max(1, Math.ceil(chunk.length / CHARS_PER_LINE)) + chunk.split('\n\n').length;
        overlays.push(textOverlay(chunk, {
          x: MARGIN,
          y: cursor,
          width: CONTENT_WIDTH,
          // Clamped to the page: an overlay taller than the paper is one whose
          // handles cannot be reached in the editor.
          //
          // A backstop, not a working part — `paginateProse` budgets in the
          // same lines this measures in, and its estimate is never lower, so
          // under today's constants the clamp does not bind. It is here for the
          // day `LINES_AFTER_HEADING` or the type sizes move. Verified by
          // mutation: raising the budget *and* removing this is what makes the
          // "every overlay inside the page" test fail.
          height: Math.min(lines * BODY_LINE_HEIGHT, PAGE_HEIGHT - MARGIN - cursor),
        }));
      }

      const name = chunks.length > 1
        ? `${number} ${chapter.title} (${part + 1}/${chunks.length})`
        : `${number} ${chapter.title}`;
      pages.push(freePage(name.slice(0, 80), overlays));
    });
  });

  return ReportTemplateSchema.parse({
    version: 1,
    name: input.title || 'Converted template',
    // The repo's own defaults, exactly as `makeBlankTemplate()` uses them.
    //
    // Not an empty token set: `resolveBindable` falls back to the literal
    // string when a `token:` key is missing, so a template with no
    // `tokens.fonts` would set its body copy in a font called
    // "token:heading". Every reference this module emits — `primary`, `bg`,
    // `text`, `muted`, `heading`, `body` — is a key in here.
    tokens: DEFAULT_BRAND_TOKENS,
    pages,
    slots: {},
    meta: {
      title: input.title || 'Converted template',
      subject: input.formatName,
    },
  });
}
