/**
 * Which template an older, browser-drawn document is printed in.
 *
 * ## The owner's rule (26 Sep 2026)
 *
 * The documents drawn in the browser before the design system existed — the
 * Cash Flow, Borrowing Capacity, Strategy Rationale and Portfolio PDFs, the
 * client details form, the Q&A editors' exports, the market intelligence
 * layout — were built around NPC's own artwork: a finished cover with NPC's
 * monogram and name in it, NPC's gold and navy, and on the closing page
 * whatever wording the settings held. The owner asked for that artwork to be
 * "a legacy, which will be deprecated and hidden on the clone and only
 * available on the prime", with "no changes of the content and how the
 * reports are being pushed, just the template", and "everything from a white
 * labeling component" put through for the clone.
 *
 * So there are exactly two templates, decided by the deployment alone:
 *
 *  - **`house`** — the prime. The document is drawn exactly as it always has
 *    been, byte for byte: nothing here is even read, so no setting and no
 *    failed read can move a pixel of the prime's legacy output.
 *  - **`issuer`** — every clone. The same document, the same content, the same
 *    delivery, in the issuer's own template: its name, its mark, its brand
 *    colour grown into a family (`brandFamily.pure.ts`), and a closing page in
 *    its own words (`issuerClosingPage`). Where the clone has named nobody the
 *    platform issues — Aurixa Systems, its emblem and its colours.
 *
 * The deployment is the backend the build talks to (`isPrimeDeployment`),
 * never a name a settings row can hold: a clone seeded from the prime's rows
 * holds NPC's name, and must still not print it.
 *
 * ## A template design somebody chose
 *
 * Some of these documents have no template of their own and wear the design
 * chosen for the report type they are made from (`drawnDocumentDesign.ts`).
 * A design is a choice to leave the house artwork: NPC's cover is a finished
 * picture in NPC's gold and navy, and no colourway can be applied to it. So a
 * document given a design is drawn in the issuer's template on EVERY
 * deployment, the prime included, with the design's colours in place of the
 * brand's and its cover's ground, frame and faces. On the prime the issuer is
 * still the house — its name, its contact details, its disclaimer — because a
 * design changes how a document looks and never whose it is. With no design,
 * nothing here changes: the prime draws its artwork and reads nothing.
 *
 * Never throws: a read that fails is an unset setting, a mark that cannot be
 * read is a cover without one.
 */
import {
  DEFAULT_DEPS,
  isPrimeBuild,
  loadIssuerLook,
  loadIssuerMarks,
  type StandardPresentationBrandDeps,
} from './investment/standardPresentationBrand';
import type { InvestmentPdfPicture } from './investment/investmentPdfPictures';
import {
  isHouseTagline,
  issuerContactDetails,
  namesTheHouse,
  resolveReportDisclaimer,
  resolveReportIssuer,
  type IssuerDeployment,
  type ReportIssuer,
} from './issuerIdentity.pure';
import type { BrandFamily } from '@/lib/reportDesign/brandFamily.pure';
import { isLightGround, lockupGround, type DrawnDocumentDesign } from '@/lib/reportDesign/drawnDesign.pure';
import { toRgb255 } from '@/lib/reportDesign/brandFamily.pure';
import { hexToHsl } from '@/lib/reportDesign/color.pure';
import type { ResolvedReportPalette } from '@/lib/reportDesign/roles.pure';

/** The prime: NPC's legacy artwork, drawn as it always was. */
export interface HouseLegacyBrand {
  artwork: 'house';
  deployment: IssuerDeployment;
}

/** A clone, or any document given a design: the issuer's own template for the same document. */
export interface IssuerLegacyBrand {
  artwork: 'issuer';
  deployment: IssuerDeployment;
  issuer: ReportIssuer;
  /** The issuer's brand family — or, with a design, the design's (`familyFromDesignPalette`). */
  family: BrandFamily;
  /** The issuer's mark for a dark ground, or the platform's emblem; null where there is none. */
  mark: InvestmentPdfPicture | null;
  /**
   * The template design the document is drawn in; absent for the issuer's own
   * brand. The cover takes its ground, frame and faces.
   */
  design?: DrawnDocumentDesign | null;
  /** The issuer's mark for a light ground — read only where a design sets the lockup on one. */
  paperMark?: InvestmentPdfPicture | null;
}

export type LegacyDocumentBrand = HouseLegacyBrand | IssuerLegacyBrand;

/**
 * The template for this deployment's document.
 *
 * `contactCompanyName` is `global_report_settings.contact_details.company_name`,
 * which every one of these generators reads for its closing page — so the
 * cover and the closing page resolve one issuer from the same values. A
 * generator that reads its settings only at the end passes a function instead,
 * which is called on a clone alone: the prime reads nothing it did not read
 * before.
 */
export async function loadLegacyDocumentBrand(
  contactCompanyName: unknown | (() => Promise<unknown>),
  deps: StandardPresentationBrandDeps = DEFAULT_DEPS,
  design: DrawnDocumentDesign | null = null,
): Promise<LegacyDocumentBrand> {
  const deployment: IssuerDeployment = { prime: isPrimeBuild(deps) };
  if (deployment.prime && !design) return { artwork: 'house', deployment };
  const issuer = await readIssuer(contactCompanyName, deps, deployment);
  if (!design) {
    const { mark, family } = await loadIssuerLook(issuer, deps);
    return { artwork: 'issuer', deployment, issuer, family, mark };
  }
  // The design supplies the colours, so the brand colour is not read.
  const { mark, paperMark } = await loadIssuerMarks(issuer, deps, { onPaper: isLightGround(lockupGround(design)) });
  return { artwork: 'issuer', deployment, issuer, family: design.family, mark, design, paperMark };
}

/** The issuer, from the contact company name and the Branding page's name, in that order. */
async function readIssuer(
  contactCompanyName: unknown | (() => Promise<unknown>),
  deps: StandardPresentationBrandDeps,
  deployment: IssuerDeployment,
): Promise<ReportIssuer> {
  const [companyName, brandName] = await Promise.all([
    typeof contactCompanyName === 'function'
      ? Promise.resolve().then(contactCompanyName as () => Promise<unknown>).catch(() => null)
      : contactCompanyName,
    deps.loadOrganisation().then((row) => row?.company_name ?? null, () => null),
  ]);
  return resolveReportIssuer({ companyName, brandName }, deployment);
}

/**
 * The business a clone's document names, for a document that carries its
 * issuer's NAME and nothing else of the issuer's template — the intake pack,
 * whose approved files name the house (`packPresentation.ts`).
 *
 * `undefined` on the prime, which reads nothing: the house names itself, as
 * it always has. On a clone, the business the clone's settings name — the same
 * resolver, in the same order, as every other document's issuer — or null
 * where they name nobody. Never the platform: Aurixa issues an unbranded
 * document, but it is not a party to anybody's client form. Never throws; a
 * setting that cannot be read is one that names nobody.
 */
export async function loadCloneIssuerName(
  contactCompanyName: unknown | (() => Promise<unknown>),
  deps: StandardPresentationBrandDeps = DEFAULT_DEPS,
): Promise<string | null | undefined> {
  if (isPrimeBuild(deps)) return undefined;
  const issuer = await readIssuer(contactCompanyName, deps, { prime: false });
  return issuer.kind === 'workspace' ? issuer.name : null;
}

/**
 * The colour a document's highlight ramp is grown from.
 *
 * Portfolio and the Formara form grow a gold ramp — the highlight, a lighter
 * and a deeper shade, and a pale tint — from ONE colour
 * (`getBrandPdfPalette`). On the prime that has always been the app's accent
 * colour, and it still is: nothing on the prime changes. On a clone it is the
 * colour the rest of the document is drawn in — the brand family's own source,
 * which is the Branding page's colour (`whitelabelBrandColour`), or Aurixa's
 * gold where none is set — so one document never carries two brand colours.
 * Only the source changes; the ramp is grown exactly as before.
 */
export function highlightColourFor(
  brand: LegacyDocumentBrand,
  appAccentHsl: string | null | undefined,
): string | null | undefined {
  return brand.artwork === 'issuer' ? hexToHsl(brand.family.brand) : appAccentHsl;
}

interface ClosingSettings<C, D> {
  contactDetails: C;
  disclaimer: D;
}

/**
 * The closing page's three inputs for an issuer's document: the contact block
 * under the issuer's name (never a field that names the house), the disclaimer
 * that issuer is entitled to speak (the platform's for a platform document;
 * never wording that names the house — `issuerIdentity.pure.ts`), and the
 * issuer's palette.
 */
export function issuerClosingPage<
  C extends object,
  D extends object,
>(
  brand: IssuerLegacyBrand,
  settings: ClosingSettings<C, D>,
): { contact: C & { company_name: string }; disclaimer: D & { text: string; is_enabled: boolean }; palette: ResolvedReportPalette } {
  const issued = resolveReportDisclaimer(brand.issuer, settings.disclaimer, brand.deployment);
  return {
    contact: issuerContactDetails(settings.contactDetails, brand.issuer, brand.deployment),
    disclaimer: { ...settings.disclaimer, text: issued.text, is_enabled: issued.text !== '' },
    palette: brand.family.palette,
  };
}

/**
 * A line of an issuer document that the settings supply — a footer's
 * disclaimer, a tagline, a contact value — as the issuer may print it: the
 * house's words are the house's own (`namesTheHouse`, and the house's tagline),
 * so on an issuer's document they are replaced by `fallback`, which is itself
 * never the house's.
 */
export function issuerLine(text: unknown, fallback: string | null = null): string | null {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value || namesTheHouse(value) || isHouseTagline(value)) {
    return fallback && !namesTheHouse(fallback) && !isHouseTagline(fallback) ? fallback : null;
  }
  return value;
}

/**
 * The borrowing capacity section's four brand roles, in an issuer's family —
 * for the section both jsPDF documents embed (`borrowingCapacityPdfSections`):
 * its brand for rules, a legible ink of it for small type, the ink that reads
 * on its deep shade, and the deep shade itself.
 */
export function issuerSectionColours(family: BrandFamily): {
  gold: { r: number; g: number; b: number };
  goldText: { r: number; g: number; b: number };
  goldOnNavy: { r: number; g: number; b: number };
  navy: { r: number; g: number; b: number };
} {
  return {
    gold: toRgb255(family.accent),
    goldText: toRgb255(family.accentInk),
    goldOnNavy: toRgb255(family.onDeep),
    navy: toRgb255(family.deep),
  };
}

/**
 * The face a document's headings are set in.
 *
 * Helvetica, as every one of these documents has always set them — on the
 * prime and on a clone alike — unless a design sets its headings in a serif,
 * when they are set in Times (`drawnDesign.pure.ts`). Never Courier: a heading
 * is placed for Helvetica's widths, and Courier is wider.
 */
export function headingFaceFor(brand: LegacyDocumentBrand): 'helvetica' | 'times' {
  return brand.artwork === 'issuer' && brand.design?.faces.heading === 'times' ? 'times' : 'helvetica';
}

/** A family colour as the `[r, g, b]` triple jsPDF's colour setters spread. */
export function rgbTriple(hex: string): [number, number, number] {
  const { r, g, b } = toRgb255(hex);
  return [r, g, b];
}

/** A family colour as the `{ r, g, b }` object several generators keep their palette in. */
export function rgbObject(hex: string): { r: number; g: number; b: number } {
  return toRgb255(hex);
}
