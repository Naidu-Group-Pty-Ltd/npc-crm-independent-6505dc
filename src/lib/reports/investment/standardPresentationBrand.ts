/**
 * Who the standard presentation is issued by, which cover that earns, the
 * issuer's own mark for it, and the colours its pages are drawn in — read from
 * this deployment's settings.
 *
 * The decisions are `standardCover.pure.ts`; this module only gathers what they
 * need. The issuer comes from the resolver every other report surface uses
 * (`resolveReportIssuer`): the report contact's company name first, then the
 * Branding page's name, then the platform. The mark comes from the same brand
 * store a chosen template's lockup does (`loadBrandMarks`), in its knockout
 * form, because the cover is a dark ground. The colours are the Branding
 * page's brand colour grown into a family (`brandFamily.pure.ts`) — the
 * platform's own gold-on-obsidian where the deployment has none.
 *
 * Under NPC's artwork there is no family: the prime's own document keeps the
 * house colours it has always been drawn in, byte for byte.
 *
 * Never throws. A setting that cannot be read resolves the way an unset one
 * does, and a mark that cannot be read is a cover with a name and no mark —
 * a document is never lost to its letterhead.
 */
import { loadBrandColour, loadBrandMarks, loadOrganisation } from '@/lib/reportTemplate/adapters/organisation';
import { resolveBrandFamily, type BrandFamily } from '@/lib/reportDesign/brandFamily.pure';
import { pictureFromDataUri } from '@/lib/reportTemplate/adapters/reportPhotographs';
import { isPrimeDeployment } from '@/lib/primeDeployment';
import { resolveReportIssuer, type IssuerDeployment, type ReportIssuer } from '@/lib/reports/issuerIdentity.pure';
import { standardCoverFor, type StandardCoverKind } from './standardCover.pure';
import type { InvestmentPdfPicture } from './investmentPdfPictures';

export interface StandardPresentationBrand {
  issuer: ReportIssuer;
  /**
   * Which deployment this is — the answer every identity decision below took,
   * handed on so the closing page's disclaimer takes the same one.
   */
  deployment: IssuerDeployment;
  cover: StandardCoverKind;
  /** The issuer's mark for a dark ground; null where it has none or it could not be read. */
  mark: InvestmentPdfPicture | null;
  /**
   * The colours an issuer's pages are drawn in. Null under NPC's artwork, whose
   * document keeps the house colours it has always had.
   */
  family: BrandFamily | null;
}

/**
 * The platform's own emblem, for a document the platform issues.
 *
 * An unbranded deployment is an Aurixa deployment, not one with no identity —
 * the rule `platformBrand.ts` applies to the favicon. This is the emblem the
 * Compliance Passport already prints, on transparent ground, so it sits on the
 * cover's field without a tile behind it.
 */
export const PLATFORM_COVER_MARK = '/brand/aurixa-emblem-240.png';

export interface StandardPresentationBrandDeps {
  loadOrganisation: () => Promise<{ company_name?: string | null } | null>;
  loadBrandMarks: () => Promise<{ mark?: string | null; markMono?: string | null }>;
  /** The Branding page's colour as `#RRGGBB`, or null for none. */
  loadBrandColour: () => Promise<string | null>;
  prime: () => boolean;
  /** A `data:` URI as a picture pdf-lib can embed, or null. */
  picture: (dataUri: string) => Promise<InvestmentPdfPicture | null>;
  /** A same-origin static file as a picture, or null. */
  staticPicture: (path: string) => Promise<InvestmentPdfPicture | null>;
}

/**
 * A WebP mark redrawn as a PNG, keeping its transparency — pdf-lib embeds only
 * PNG and JPEG, and a JPEG has no alpha, so a knockout mark would come out on
 * a white tile. Null outside a browser.
 */
async function redrawAsPng(dataUri: string): Promise<string | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  const blob = await (await fetch(dataUri)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    const png = canvas.toDataURL('image/png');
    return png.startsWith('data:image/png') ? png : null;
  } finally {
    bitmap.close?.();
  }
}

async function markPicture(dataUri: string): Promise<InvestmentPdfPicture | null> {
  const direct = pictureFromDataUri(dataUri);
  if (direct) return direct;
  if (!/^data:image\/webp;/i.test(dataUri)) return null;
  return pictureFromDataUri(await redrawAsPng(dataUri));
}

async function staticPicture(path: string): Promise<InvestmentPdfPicture | null> {
  const response = await fetch(path);
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return png ? { bytes, format: 'png' } : null;
}

export const DEFAULT_DEPS: StandardPresentationBrandDeps = {
  loadOrganisation,
  loadBrandMarks,
  loadBrandColour,
  prime: () => isPrimeDeployment(),
  picture: markPicture,
  staticPicture,
};

/**
 * The issuer, its cover and its mark.
 *
 * `contactCompanyName` is `global_report_settings.contact_details.company_name`,
 * which the caller has already read for the closing page — so the cover and the
 * closing page resolve their issuer from the same values.
 */
export async function loadStandardPresentationBrand(
  contactCompanyName: unknown,
  deps: StandardPresentationBrandDeps = DEFAULT_DEPS,
): Promise<StandardPresentationBrand> {
  const brandName = await deps.loadOrganisation()
    .then((row) => row?.company_name ?? null, () => null);
  // On a clone the house's name is not an identity, whatever a row says
  // (`issuerIdentity.pure.ts`); on the prime every name reads as it always did.
  const deployment: IssuerDeployment = { prime: isPrime(deps) };
  const issuer = resolveReportIssuer({ companyName: contactCompanyName, brandName }, deployment);
  const cover = standardCoverFor(issuer, deployment);
  if (cover === 'template') return { issuer, deployment, cover, mark: null, family: null };
  const { mark, family } = await loadIssuerLook(issuer, deps);
  return { issuer, deployment, cover, mark, family };
}

/**
 * The issuer's mark for a dark ground and its colours — what any document
 * drawn under the issuer's own name needs, whichever library draws it. The
 * older client-side documents ask the same question (`legacyDocumentBrand.ts`)
 * and get the same answer.
 */
export async function loadIssuerLook(
  issuer: ReportIssuer,
  deps: StandardPresentationBrandDeps = DEFAULT_DEPS,
): Promise<{ mark: InvestmentPdfPicture | null; family: BrandFamily }> {
  const [mark, family] = await Promise.all([issuerMark(issuer, deps), issuerFamily(issuer, deps)]);
  return { mark, family };
}

/**
 * The issuer's marks alone, for a document whose colours come from somewhere
 * else — a template design somebody chose (`legacyDocumentBrand.ts`).
 *
 * `onPaper` is the mark for a light ground: the Branding page's full-colour
 * mark, or the platform's emblem. The knockout mark a dark ground takes is
 * drawn for a dark field, and on paper it can be a white shape on a white
 * sheet — so a cover drawn on paper asks for this one, and a cover with no
 * paper does not read it at all.
 */
export async function loadIssuerMarks(
  issuer: ReportIssuer,
  deps: StandardPresentationBrandDeps = DEFAULT_DEPS,
  want: { onPaper: boolean } = { onPaper: false },
): Promise<{ mark: InvestmentPdfPicture | null; paperMark: InvestmentPdfPicture | null }> {
  const [mark, paperMark] = await Promise.all([
    issuerMark(issuer, deps),
    want.onPaper ? issuerPaperMark(issuer, deps) : Promise.resolve(null),
  ]);
  return { mark, paperMark };
}

/** Whether this build is the prime's, read safely — the rule `isPrimeDeployment` states. */
export function isPrimeBuild(deps: StandardPresentationBrandDeps = DEFAULT_DEPS): boolean {
  return isPrime(deps);
}

/**
 * The issuer's colours: its brand colour's family, or the platform's.
 *
 * A document the platform issues (no business named) takes the platform's
 * colours even where a colour is stored — an unbranded deployment is Aurixa's,
 * and the name and the colour on its cover should agree about whose it is.
 */
async function issuerFamily(
  issuer: ReportIssuer,
  deps: StandardPresentationBrandDeps,
): Promise<BrandFamily> {
  if (issuer.kind === 'platform') return resolveBrandFamily(null);
  const colour = await deps.loadBrandColour().catch(() => null);
  return resolveBrandFamily(colour);
}

/** A build whose deployment cannot be read is not the prime — the rule `isPrimeDeployment` states. */
function isPrime(deps: StandardPresentationBrandDeps): boolean {
  try {
    return deps.prime();
  } catch {
    return false;
  }
}

async function issuerMark(
  issuer: ReportIssuer,
  deps: StandardPresentationBrandDeps,
): Promise<InvestmentPdfPicture | null> {
  try {
    if (issuer.kind === 'platform') return await deps.staticPicture(PLATFORM_COVER_MARK);
    const marks = await deps.loadBrandMarks();
    return marks.markMono ? await deps.picture(marks.markMono) : null;
  } catch (err) {
    console.warn('[standardPresentationBrand] the issuer mark could not be read', err);
    return null;
  }
}

async function issuerPaperMark(
  issuer: ReportIssuer,
  deps: StandardPresentationBrandDeps,
): Promise<InvestmentPdfPicture | null> {
  try {
    if (issuer.kind === 'platform') return await deps.staticPicture(PLATFORM_COVER_MARK);
    const marks = await deps.loadBrandMarks();
    return marks.mark ? await deps.picture(marks.mark) : null;
  } catch (err) {
    console.warn('[standardPresentationBrand] the issuer mark for paper could not be read', err);
    return null;
  }
}
