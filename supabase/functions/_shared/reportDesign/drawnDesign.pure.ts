/**
 * A chosen template, as the design of a document that is DRAWN rather than
 * typeset.
 *
 * ## Which documents
 *
 * Nine report types are typeset, and a template chosen for one of them is drawn
 * as that report's design by its own route (`templateDesign.pure.ts`). Nine more
 * documents are drawn in the browser — jsPDF, a print stylesheet, a picture of
 * the page, a Word or an Excel file — and have no template of their own:
 * Strategy Rationale, the Commercial and Industrial Investment Reports, the C&I
 * ten-year cash flow, Client Property Analysis, the C&I intake pack, the
 * quantitative market report, the Overview snapshot and the call log export.
 * Each is made from one of the report types a person chooses a template for,
 * and wears the design chosen for that report type (`DRAWN_DOCUMENTS` in
 * `templateDesignRoute.pure.ts`). The lender packet's cover sheet is not one of
 * them: it is drawn in the finance partner's session, which cannot read the
 * adviser's choice.
 *
 * ## What a drawn document can take from a design
 *
 * A typeset document takes a design whole. A drawn document can honour three
 * of its four parts exactly and the fourth approximately:
 *
 *  - **The colours**, as the family the drawn documents already take on a
 *    clone (`familyFromDesignPalette`), measured on the white sheet they
 *    print on.
 *  - **The cover's ground** — the whole sheet in the field colour, a band of it
 *    across the head of the sheet, or the design's paper — and whether the
 *    cover is framed. These are what tells one family of the catalogue from
 *    another on the first page: 19 of its 50 designs are field covers, 18 band
 *    covers and 13 paper covers, six of those framed.
 *  - **The faces, approximately.** A PDF drawn in the browser has three faces
 *    every reader holds: Helvetica, Times and Courier. A design whose headings
 *    are set in a serif sets them in Times; every other design keeps Helvetica.
 *    Courier is used only for the cover's name, which is fitted to its measure
 *    in whatever face it is drawn in: a heading drawn at a fixed position was
 *    placed for Helvetica's widths, and Courier is wider. Embedding a design's
 *    own faces would add a font file to every download, and the design's faces
 *    are already exact wherever the document is typeset.
 *
 * ## What it never changes
 *
 * The words, the figures and the pages: a drawn document computes what it
 * prints before it chooses a colour, and a design reaches none of that.
 *
 * Pure: sibling `.pure` imports only, no I/O.
 */
import { familyFromDesignPalette, type BrandFamily } from './brandFamily.pure.ts';
import { relativeLuminanceFromHex } from './color.pure.ts';
import type { ReportTemplateDesign } from './templateDesign.pure.ts';

/** The three faces every PDF reader holds, by the names jsPDF gives them. */
export type DrawnFace = 'helvetica' | 'times' | 'courier';

/** The cover grounds of the catalogue. */
export type DrawnCoverGround = 'field' | 'band' | 'paper';

export interface DrawnDocumentDesign {
  /** The design's name, as the chooser shows it. */
  label: string;
  /** The colours, grown from the design's palette and measured on white. */
  family: BrandFamily;
  cover: {
    ground: DrawnCoverGround;
    /** A rule drawn around the cover, inside the trim. */
    frame: boolean;
  };
  faces: {
    /** The issuer's name on the cover. */
    cover: DrawnFace;
    /** Chapter and section headings. */
    heading: DrawnFace;
  };
}

/** The generic family a CSS font stack ends in, or null for none of the three. */
export function genericOfStack(stack: string | null | undefined): 'serif' | 'sans-serif' | 'monospace' | null {
  const last = String(stack ?? '').split(',').pop()?.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  return last === 'serif' || last === 'sans-serif' || last === 'monospace' ? last : null;
}

/**
 * The standard face that stands in for a design's face.
 *
 * A serif is Times wherever it is used. A monospace is Courier only on the
 * cover's name, which is measured in the face it is drawn in; a heading keeps
 * Helvetica, because Courier is wider than what it was placed for. Anything
 * else — a sans, or a stack naming no generic — is Helvetica, which every drawn
 * document already sets.
 */
export function drawnFaceFor(stack: string | null | undefined, role: 'cover' | 'heading'): DrawnFace {
  const generic = genericOfStack(stack);
  if (generic === 'serif') return 'times';
  if (generic === 'monospace' && role === 'cover') return 'courier';
  return 'helvetica';
}

/** What a drawn document takes from a resolved design. */
export function drawnDesignOf(design: ReportTemplateDesign): DrawnDocumentDesign {
  const { layer } = design;
  return {
    label: design.label,
    family: familyFromDesignPalette(design.palette),
    cover: { ground: layer.coverGround, frame: layer.coverFrame },
    faces: {
      cover: drawnFaceFor(layer.typography.cover, 'cover'),
      heading: drawnFaceFor(layer.typography.display, 'heading'),
    },
  };
}

/**
 * The colour the cover's lockup — the issuer's mark and name — is drawn on:
 * the design's paper on a paper cover, and its field on a field or band cover,
 * whose band carries the lockup.
 */
export function lockupGround(design: DrawnDocumentDesign): string {
  return design.cover.ground === 'paper' ? design.family.palette.paper : design.family.field;
}

/**
 * Whether a ground is light — so a mark drawn for it is the issuer's colour
 * mark rather than the knockout drawn for a dark field. Judged by which of
 * black and white it sets off better, because a catalogue "paper" can be a
 * dark paper (its inverse colourways).
 *
 * Black's relative luminance is 0 and white's is 1, so both contrasts follow
 * from the ground's own luminance, exactly as `contrastRatio` computes them.
 */
export function isLightGround(hex: string): boolean {
  const l = relativeLuminanceFromHex(hex);
  const againstBlack = (l + 0.05) / (0 + 0.05);
  const againstWhite = (1 + 0.05) / (l + 0.05);
  return againstBlack > againstWhite;
}
