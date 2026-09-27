/**
 * The intake pack as a deployment hands it over.
 *
 * The two blank documents are supplied, approved files (`sourceDocuments.ts`),
 * and on the prime with no design chosen they are handed over exactly as they
 * are — this module is not called at all. Two things can differ from that,
 * and each is a change to named bytes inside the file, never a re-authoring
 * of it:
 *
 * ## Whose pack it is (a clone)
 *
 * The approved files name the house in four places: the workbook's consent
 * clause and the footer of every one of its twelve sheets, the interview
 * guide's sign-off row, and both files' document properties — where the
 * house's name is the author and the house's director is the last editor. On
 * a clone that is another business's name on this business's client form,
 * and in the consent clause it is the wrong party: the client would be
 * consenting to a business they have never dealt with collecting their
 * information. The owner's rule (26 Sep 2026) is that a clone never sees the
 * house's identity.
 *
 * The approved files already say what to write instead. They were supplied
 * with placeholders in the parallel places: the guide's consent clause reads
 * "The client consents to (Company/Business Name) collecting…" where the
 * workbook's names the house, and the workbook's sign-off reads "Completed by
 * (Company Name)" where the guide's names the house. So on a clone:
 *
 *  - a business the clone's settings name is written where the house was;
 *  - where they name nobody, the pack's OWN placeholder for that place is —
 *    never the platform, because Aurixa collects nobody's information and
 *    completes nobody's pack — and a footer simply loses the name, as the
 *    guide's footer never had one;
 *  - the house's director is taken out of the document properties, and the
 *    author is the business or nobody.
 *
 * Nothing the approved file leaves open is filled in: a placeholder the prime
 * hands over is handed over by a clone too.
 *
 * ## How it looks (a design somebody chose)
 *
 * The pack wears the design chosen for Commercial & Industrial Capacity
 * (`DRAWN_DOCUMENTS`). Only its three BRAND colours move — the brown of its
 * titles, header bands and sheet tabs, the bronze of its eyebrows and rules,
 * and the pale bronze of its input borders and placeholder hints. Everything
 * else stays the approved file's, because everything else carries meaning: the
 * cream fill says "yours to fill in", the conditional highlight says "required
 * and still empty", and the greys are the greys a client reads.
 *
 * Each brand colour takes the design's own colour for its role, and is never
 * less legible than the approved colour it replaces (measured on white, the
 * sheet the pack prints on). The placeholder hint is held to the approved
 * hint's faintness as well, because a hint as dark as an answer reads as one.
 *
 * ## What cannot happen
 *
 * A clone's pack that still names the house after the substitutions is
 * refused rather than handed over (`PackStillNamesTheHouse`): a document that
 * says less is recoverable, one that names another business is not.
 */
import type JSZip from 'jszip';
import { namesTheHouse } from '@/lib/reports/issuerIdentity.pure';
import type { DrawnDocumentDesign } from '@/lib/reportDesign/drawnDesign.pure';
import {
  contrastRatio,
  ensureContrast,
  hexToHsl,
  hslComponentsToHex,
  parseHsl,
} from '@/lib/reportDesign/color.pure';
import type { PackDocumentKind } from './sourceDocuments';

/** The house's name, exactly as the approved files spell it. */
export const PACK_HOUSE_NAME = 'Naidu Property Consulting Services';

/**
 * The approved files' own words for the places the house is named, where a
 * clone's settings name nobody. Quoted from the files, never composed here.
 */
export const PACK_PLACEHOLDER = Object.freeze({
  /** The workbook's sign-off row: "Completed by (Company Name)". */
  signOff: 'Company Name',
  /** The guide's consent clause: "The client consents to (Company/Business Name) collecting…". */
  consent: '(Company/Business Name)',
});

/**
 * The approved files' three brand colours, as they are written in the files.
 *
 *  - `deep` — titles, the header bands white type sits on, the sheet tabs.
 *  - `accent` — eyebrows and question labels, rules, one highlighted band.
 *  - `hint` — input borders and placeholder hints ("$", "DD / MM / YYYY").
 */
export const PACK_BRAND_COLOURS = Object.freeze({
  deep: '5C3F1F',
  accent: 'A9853F',
  hint: 'C9AE7C',
});

export type PackBrandRole = keyof typeof PACK_BRAND_COLOURS;

// eslint-disable-next-line no-restricted-syntax -- the page ground the approved pack's colours are measured against, in a Word/Excel document, not the UI
const WHITE = '#FFFFFF';

export interface PackPresentation {
  /**
   * Who the pack names where the approved file names the house. Absent on the
   * prime, where the house names itself; on a clone, the business its settings
   * name, or null where they name nobody.
   */
  issuerName?: string | null;
  /** The design chosen for the report type the pack wears, or none. */
  design?: DrawnDocumentDesign | null;
}

/** Whether the approved file is handed over untouched. */
export function handsOverApprovedFile(presentation: PackPresentation): boolean {
  return presentation.issuerName === undefined && !presentation.design;
}

// ── Colours ──────────────────────────────────────────────────────────────────

/** How legible an approved colour is on the white sheet. */
function approvedContrast(role: PackBrandRole): number {
  return contrastRatio(`#${PACK_BRAND_COLOURS[role]}`, WHITE);
}

/**
 * The lightest shade of a colour's hue that is at least as legible as the
 * approved hint — so a design's hint is exactly as faint as the approved one,
 * in the design's hue, with no more saturation than the approved hint has.
 */
function hintOf(accentHex: string): string {
  const { h, s } = parseHsl(hexToHsl(accentHex));
  const approved = parseHsl(hexToHsl(`#${PACK_BRAND_COLOURS.hint}`));
  const saturation = Math.min(s, approved.s);
  const floor = approvedContrast('hint');
  for (let l = 100; l >= 0; l -= 0.5) {
    const candidate = hslComponentsToHex(h, saturation, l);
    if (contrastRatio(candidate, WHITE) >= floor) return candidate.toUpperCase();
  }
  return hslComponentsToHex(h, saturation, 0).toUpperCase();
}

/**
 * The design's colour for each of the pack's brand roles, `RRGGBB`.
 *
 * `deep` is the design's deep shade and `accent` its accent — each darkened
 * only as far as it must be to read as well as the approved colour did.
 */
export function packBrandColours(design: DrawnDocumentDesign): Record<PackBrandRole, string> {
  const family = design.family;
  const bare = (hex: string) => hex.replace('#', '').toUpperCase();
  return {
    deep: bare(ensureContrast(family.deep, WHITE, approvedContrast('deep'))),
    accent: bare(ensureContrast(family.accent, WHITE, approvedContrast('accent'))),
    hint: bare(hintOf(family.accent)),
  };
}

/** The approved colour → the design's, for a table of three. */
function colourMap(design: DrawnDocumentDesign): Map<string, string> {
  const mapped = packBrandColours(design);
  return new Map((Object.keys(PACK_BRAND_COLOURS) as PackBrandRole[])
    .map((role) => [PACK_BRAND_COLOURS[role], mapped[role]]));
}

/**
 * Recolour a Word part: every attribute whose whole value is one of the three
 * brand colours (`w:color w:val`, a border's `w:color`, a shading's `w:fill`).
 * A six-digit value in quotes cannot be a revision or paragraph id, which are
 * eight.
 */
export function recolourWordPart(xml: string, design: DrawnDocumentDesign): string {
  const map = colourMap(design);
  return xml.replace(/="([0-9A-Fa-f]{6})"/g, (whole, hex: string) => {
    const to = map.get(hex.toUpperCase());
    return to ? `="${to}"` : whole;
  });
}

/** An ARGB value in a spreadsheet part, recoloured where it is a brand colour. */
function recolourArgb(xml: string, map: Map<string, string>): string {
  return xml.replace(/rgb="([0-9A-Fa-f]{2})([0-9A-Fa-f]{6})"/g, (whole, alpha: string, hex: string) => {
    const to = map.get(hex.toUpperCase());
    return to ? `rgb="${alpha}${to}"` : whole;
  });
}

/**
 * Recolour the workbook's stylesheet: its fonts, fills and borders only.
 *
 * Its `<colors>` (the legacy indexed palette and Excel's recently-used list)
 * and its `<dxfs>` (the conditional "required and still empty" highlight) are
 * left exactly as approved — one is not a style anything uses, and the other
 * is a meaning, not a brand.
 */
export function recolourWorkbookStyles(xml: string, design: DrawnDocumentDesign): string {
  const map = colourMap(design);
  return xml.replace(/<(fonts|fills|borders)\b[^>]*>[\s\S]*?<\/\1>/g, (section) => recolourArgb(section, map));
}

/** Recolour a worksheet's tab. Nothing else in a sheet carries a brand colour. */
export function recolourWorksheet(xml: string, design: DrawnDocumentDesign): string {
  const map = colourMap(design);
  return xml.replace(/<tabColor\b[^>]*\/>/g, (tab) => recolourArgb(tab, map));
}

// ── Names ────────────────────────────────────────────────────────────────────

/** The longest business name a pack carries. */
const NAME_LIMIT = 200;

/** Whether XML 1.0 allows this code point in a document at all. */
function isXmlChar(cp: number): boolean {
  return cp === 0x9 || cp === 0xa || cp === 0xd
    || (cp >= 0x20 && cp <= 0xd7ff)
    || (cp >= 0xe000 && cp <= 0xfffd)
    || (cp >= 0x10000 && cp <= 0x10ffff);
}

/**
 * A business name as a pack can carry it, or null for nobody named.
 *
 * A character XML does not allow makes the whole part unreadable, so it is
 * removed rather than escaped, and runs of space become one space. Found in
 * the audit before this shipped: a control character in a clone's name left
 * fourteen parts of the workbook malformed.
 *
 * A name longer than any business name is read as nobody named rather than
 * cut short, because a shortened name is not the business's name. The pack's
 * own placeholders stand in, as they do for a clone that names nobody.
 */
export function packSafeName(name: string | null): string | null {
  if (name === null) return null;
  const allowed = Array.from(name).filter((ch) => isXmlChar(ch.codePointAt(0) ?? 0)).join('');
  const cleaned = allowed.replace(/\s+/g, ' ').trim();
  if (!cleaned || Array.from(cleaned).length > NAME_LIMIT) return null;
  return cleaned;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const HOUSE = PACK_HOUSE_NAME.replace(/\s+/g, '\\s+');

/**
 * A name in running text: the consent clause, the sign-off row.
 *
 * In brackets the house is the name of the party completing the pack, and
 * nobody named reads as the workbook's own "(Company Name)"; unbracketed it
 * is the party the client consents to, and reads as the guide's own
 * "(Company/Business Name)".
 */
export function renameInText(xml: string, issuerName: string | null): string {
  const bracketed = new RegExp(`\\(${HOUSE}\\)`, 'g');
  const bare = new RegExp(HOUSE, 'g');
  const name = packSafeName(issuerName);
  // Function replacers: a string replacement expands `$&`, `$'` and `` $` ``,
  // and escaping turns `$'` into `$&apos;`, which starts with `$&`.
  const signOff = `(${escapeXml(name ?? PACK_PLACEHOLDER.signOff)})`;
  const consent = escapeXml(name ?? PACK_PLACEHOLDER.consent);
  return xml
    .replace(bracketed, () => signOff)
    .replace(bare, () => consent);
}

/** Excel's own limit on one header or footer, in characters. */
const HEADER_FOOTER_LIMIT = 255;

/**
 * A name in a worksheet's printed footer.
 *
 * `&` introduces a formatting code there, so a literal ampersand is written
 * twice. Nobody named, or a name that would push the footer past Excel's
 * limit, leaves the footer reading "Confidential" alone, as the guide's
 * footer always has.
 */
export function renameInHeadersAndFooters(xml: string, rawIssuerName: string | null): string {
  const issuerName = packSafeName(rawIssuerName);
  const named = new RegExp(`${HOUSE}(\\s*·\\s*)?`, 'g');
  return xml.replace(
    /<(oddHeader|oddFooter|evenHeader|evenFooter|firstHeader|firstFooter)>([\s\S]*?)<\/\1>/g,
    (whole, tag: string, body: string) => {
      const withName = issuerName
        ? body.replace(named, (_m, separator?: string) => `${escapeXml(issuerName.replace(/&/g, '&&'))}${separator ?? ''}`)
        : null;
      const next = withName !== null && unescapeXml(withName).length <= HEADER_FOOTER_LIMIT
        ? withName
        : body.replace(named, () => '');
      return `<${tag}>${next}</${tag}>`;
    },
  );
}

/**
 * The document properties: the author is the business, or nobody; the last
 * editor is nobody, because on the approved files it is a person at the house.
 */
export function renameInCoreProperties(xml: string, issuerName: string | null): string {
  const name = packSafeName(issuerName);
  const creator = `<dc:creator>${name ? escapeXml(name) : ''}</dc:creator>`;
  return xml
    .replace(/<dc:creator>[\s\S]*?<\/dc:creator>/, () => creator)
    .replace(/<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/, () => '<cp:lastModifiedBy></cp:lastModifiedBy>');
}

/** The words a part carries, for asking whether it names the house. */
function wordsOf(xml: string): string {
  return unescapeXml(xml.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
}

/** A clone's pack that still names the house is refused, never handed over. */
export class PackStillNamesTheHouse extends Error {
  constructor(readonly part: string) {
    super(`The intake pack still names another business in ${part}`);
    this.name = 'PackStillNamesTheHouse';
  }
}

// ── The files ────────────────────────────────────────────────────────────────

/** Which parts of each file are rewritten, and how. */
type PartRewrite = (xml: string, presentation: PackPresentation) => string;

const WORKBOOK_PARTS: ReadonlyArray<[RegExp, PartRewrite]> = [
  [/^xl\/worksheets\/sheet\d+\.xml$/, (xml, p) => {
    let out = xml;
    if (p.issuerName !== undefined) out = renameInHeadersAndFooters(out, p.issuerName);
    if (p.design) out = recolourWorksheet(out, p.design);
    return out;
  }],
  [/^xl\/sharedStrings\.xml$/, (xml, p) => (p.issuerName !== undefined ? renameInText(xml, p.issuerName) : xml)],
  [/^xl\/styles\.xml$/, (xml, p) => (p.design ? recolourWorkbookStyles(xml, p.design) : xml)],
  [/^docProps\/core\.xml$/, (xml, p) => (p.issuerName !== undefined ? renameInCoreProperties(xml, p.issuerName) : xml)],
];

const GUIDE_PARTS: ReadonlyArray<[RegExp, PartRewrite]> = [
  [/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/, (xml, p) => {
    let out = xml;
    if (p.issuerName !== undefined) out = renameInText(out, p.issuerName);
    if (p.design) out = recolourWordPart(out, p.design);
    return out;
  }],
  [/^word\/(styles|numbering)\.xml$/, (xml, p) => (p.design ? recolourWordPart(xml, p.design) : xml)],
  [/^docProps\/core\.xml$/, (xml, p) => (p.issuerName !== undefined ? renameInCoreProperties(xml, p.issuerName) : xml)],
];

/**
 * The pack as this deployment hands it over, or null where the approved file
 * is handed over untouched.
 *
 * Only the parts named above are read and rewritten; every other part is
 * carried across as it is. The approved file name, and every word and figure
 * of the form, stay the approved file's.
 */
export async function presentPackDocument(
  bytes: ArrayBuffer | Uint8Array,
  kind: PackDocumentKind,
  presentation: PackPresentation,
  loadZip: () => Promise<typeof JSZip> = async () => (await import('jszip')).default,
): Promise<Uint8Array | null> {
  if (handsOverApprovedFile(presentation)) return null;
  const Zip = await loadZip();
  const zip = await Zip.loadAsync(bytes);
  const rewrites = kind === 'workbook' ? WORKBOOK_PARTS : GUIDE_PARTS;
  const clone = presentation.issuerName !== undefined;

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const rewrite = rewrites.find(([pattern]) => pattern.test(entry.name))?.[1];
    // On a clone every part is read, rewritten or not: the guarantee is that
    // nothing handed over names the house, not that the parts listed do not.
    if (!rewrite && !(clone && /\.(xml|rels)$/.test(entry.name))) continue;
    const xml = await entry.async('string');
    const next = rewrite ? rewrite(xml, presentation) : xml;
    if (clone && namesTheHouse(wordsOf(next))) throw new PackStillNamesTheHouse(entry.name);
    if (next !== xml) zip.file(entry.name, next, { date: entry.date });
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}
