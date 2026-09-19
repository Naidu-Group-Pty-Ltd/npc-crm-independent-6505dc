/**
 * One input decides what this document looks like: the brand snapshot.
 *
 * The shipping generator resolves the tenant's name, then uses it only in a
 * `catch` — so a white-label tenant's Snapshot carries a raster of *our* cover
 * with *our* company name on the front and theirs on the back
 * (`BORROWING_CAPACITY.md` F1). It also carries a gold nobody chose, `#C9A55A`,
 * which is one of three in this format and none of which is the brand (F7).
 *
 * A snapshot answers both, and answers a third thing neither of them could: a
 * report re-issued a year later reproduces the brand it was issued under,
 * because the colours, the marks and the company details were written down at
 * generation time rather than looked up again.
 *
 * Nothing here fetches. `buildReportBrandSnapshot` turns records into a
 * snapshot; this turns a snapshot into the shapes the renderer takes. Both are
 * pure, so the whole brand path is testable without a database.
 */

import type { ReportBrandSnapshot } from './snapshot.pure.ts';
import {
  auditSnapshot,
  companyContactFor,
  lockupFor,
  paletteInputFor,
} from './snapshot.pure.ts';
import type { ResolvedReportPalette } from './roles.pure.ts';
import { resolveReportPalette } from './brandResolve.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from './companyBlock.pure.ts';
import { mastheadFor, resolveCompanyBlock } from './companyBlock.pure.ts';
import type { BrandLockupProps } from './primitives.pure.ts';

export interface ResolveSnapshotBrandInput {
  snapshot: ReportBrandSnapshot;
  /** `global_report_settings.disclaimer`. Absent means the house wording. */
  disclaimer?: CompanyDisclaimer | null;
  /**
   * The tenant's own cover art, already inlined as a `data:` URI.
   *
   * **Only ever the tenant's.** `defaultAssets.generated.ts` carries
   * `NPC_HOUSE_COVER_ART`, and its own doc comment says it must never be a
   * white-label fallback — it is not a photograph, it is a finished NPC cover
   * with our company name burned into the pixels. Reaching for it here would
   * reintroduce F1 through a different door. A tenant with no cover art gets
   * the typographic cover, which is a designed state, not a gap.
   */
  coverArtDataUri?: string | null;
}

export interface ResolvedSnapshotBrand {
  palette: ResolvedReportPalette;
  company: CompanyBlock;
  /** The running foot on every body page — the tenant's, never ours. */
  masthead: string;
  /** The mark on the dark cover ground, or `null` when the tenant has none. */
  lockup: BrandLockupProps | null;
  heroDataUri: string | null;
  /** Cover foot, left. From the snapshot so a tenant can word it themselves. */
  confidentiality: string;
  /**
   * What the snapshot is missing that a client-facing report wants.
   *
   * Advisory, and returned rather than thrown: a report with no ABN is a worse
   * report, not an impossible one, and refusing to render would turn a cosmetic
   * gap into an outage. Phase 4 decides where these are logged.
   */
  gaps: string[];
}

/** Printed at the foot of the cover when the snapshot names nothing. */
export const DEFAULT_CONFIDENTIALITY = 'Private and confidential';

export function resolveSnapshotBrand(input: ResolveSnapshotBrandInput): ResolvedSnapshotBrand {
  const { snapshot } = input;
  const contact = companyContactFor(snapshot);

  return {
    palette: resolveReportPalette(paletteInputFor(snapshot)),
    company: resolveCompanyBlock(contact, input.disclaimer ?? null),
    masthead: mastheadFor(contact),
    lockup: lockupFor(snapshot, 'field'),
    heroDataUri: input.coverArtDataUri ?? null,
    confidentiality: snapshot.document.confidentiality.trim() || DEFAULT_CONFIDENTIALITY,
    gaps: auditSnapshot(snapshot, input.disclaimer ?? null),
  };
}
