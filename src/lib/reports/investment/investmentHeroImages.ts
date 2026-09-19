/**
 * The hero imagery already placed against a report, fetched for the PDF.
 *
 * ## Nothing is generated here
 *
 * `hero-image-studio` is where an operator generates or uploads an image and
 * places it against a chapter. This only READS what that produced. A PDF
 * export that could mint an image would spend a vendor key at download time,
 * and two people downloading the same report would get two different
 * documents.
 *
 * ## It never fails the document
 *
 * A report with no placements, an unreachable object, a body that is not an
 * image: every one of them answers with fewer images, never with an error. The
 * document is the deliverable and a picture is not worth losing it over.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { InvestmentHeroImage } from './investmentPdfDocument';

interface PlacementRow {
  section_key?: string | null;
  section_title?: string | null;
  position_order?: number | null;
  library?: { storage_path?: string | null; public_url?: string | null } | null;
}

/** How many a single document will place. */
const MAX_HERO_IMAGES = 6;

const formatOf = (contentType: string | null, bytes: Uint8Array): 'png' | 'jpeg' | null => {
  if (contentType?.includes('png')) return 'png';
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return 'jpeg';
  // The magic numbers, because a storage object can be served with no type at
  // all and pdf-lib will throw on the wrong decoder rather than skip.
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  return null;
};

/**
 * Every placed image for a report, in the order they were placed.
 *
 * Returns an empty list rather than throwing — see the header. The URLs come
 * back already signed by `hero-image-studio`, which also applies the report's
 * own view permission, so nothing here reads storage directly.
 */
export async function loadInvestmentHeroImages(reportId: string): Promise<InvestmentHeroImage[]> {
  if (!reportId) return [];
  let placements: PlacementRow[];
  try {
    const { data, error } = await invokeSecureFunction<{ placements?: PlacementRow[] }>(
      'hero-image-studio',
      { action: 'placements_list', reportId },
    );
    if (error || !data?.placements?.length) return [];
    placements = data.placements;
  } catch (err) {
    console.warn('[investmentHeroImages] placements could not be read', err);
    return [];
  }

  const out: InvestmentHeroImage[] = [];
  for (const placement of placements.slice(0, MAX_HERO_IMAGES)) {
    const url = placement.library?.public_url;
    if (!url) continue;
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const format = formatOf(response.headers.get('content-type'), bytes);
      if (!format || !bytes.length) continue;
      out.push({
        sectionKey: placement.section_title || placement.section_key || '',
        bytes,
        format,
      });
    } catch (err) {
      console.warn('[investmentHeroImages] one image could not be fetched', err);
    }
  }
  return out;
}
