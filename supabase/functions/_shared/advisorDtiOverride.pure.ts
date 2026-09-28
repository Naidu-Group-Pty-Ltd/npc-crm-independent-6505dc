/**
 * The Strategy Advisor may relax a debt-to-income cap, never impose one.
 *
 * `dtiCapOverride` exists to model a lender whose DTI policy is looser than
 * the one binding the client ("a non-bank at 8x"). The engine reads it
 * literally: it turns the cap ON at the stated multiple. Where the Calculator
 * applies no DTI cap at all, that adds a ceiling that was not there before.
 *
 * On 28 Sep 2026 two of the three scenarios for a client assessed at 10.6x
 * proposed "10x non-bank policy to clear the DTI constraint". Each cut
 * capacity to exactly 10.00x and read as a loss. The prompt already said to
 * use the lever only when a 6x cap is the binding constraint, and the model
 * used it anyway.
 *
 * A proposal that would tighten the assessment is withheld from the
 * adjustments, on the server and again in the browser for a card kept from
 * before. The lender it names is kept, because re-shading income to that
 * lender's policy is a separate lever. The card says why the cap was not
 * applied, so the broker still knows the ratio needs a lender who accepts it.
 */

export interface DtiCapSetting {
  dtiCapEnabled: boolean;
  dtiCapLimit: number;
}

export interface DtiCapOverride {
  enabled?: boolean;
  value?: number;
  lenderProfile?: string;
}

/** True where applying the override would lower the cap the assessment already uses. */
export function dtiOverrideTightens(base: DtiCapSetting, override: DtiCapOverride | null | undefined): boolean {
  if (!override || !override.enabled) return false;
  const value = Number(override.value);
  if (!Number.isFinite(value) || value <= 0) return false;
  if (!base.dtiCapEnabled) return true;
  return value < base.dtiCapLimit;
}

export function withheldDtiOverrideNote(base: DtiCapSetting, override: DtiCapOverride): string {
  const multiple = `${Number(override.value)}x`;
  const why = base.dtiCapEnabled
    ? `the assessment already applies a ${base.dtiCapLimit}x cap, and ${multiple} would tighten it`
    : `the assessment applies no DTI cap, so a ${multiple} cap would lower capacity rather than lift it`;
  return `DTI cap of ${multiple} not applied: ${why}. The lender chosen must still accept this client's debt-to-income ratio; confirm its policy before submission.`;
}

/**
 * The adjustments with a tightening override withheld, and the note that
 * says so. Unchanged (and no note) where the override relaxes or is absent.
 */
export function withholdTighteningDtiOverride<A extends { dtiCapOverride?: DtiCapOverride | null; lenderProfile?: string | null }>(
  adjustments: A,
  base: DtiCapSetting,
): { adjustments: A; note: string | null } {
  const override = adjustments?.dtiCapOverride;
  if (!override || !dtiOverrideTightens(base, override)) return { adjustments, note: null };
  const lenderProfile = adjustments.lenderProfile ?? override.lenderProfile ?? null;
  return {
    adjustments: {
      ...adjustments,
      dtiCapOverride: null,
      ...(lenderProfile ? { lenderProfile } : {}),
    } as A,
    note: withheldDtiOverrideNote(base, override),
  };
}
