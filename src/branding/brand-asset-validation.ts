/**
 * When a brand asset slot should block saving.
 *
 * This lived inline in the Branding page as `status !== 'valid'`, which lumped
 * "no asset configured" together with "asset is broken" and disabled the Save
 * button for both. Removing a logo therefore made the page unsaveable: a tenant
 * could clear a slot in the draft but never persist it, and so could never
 * return to the platform's default artwork.
 *
 * An empty slot is a supported, intentional state — the resolver falls down the
 * chain (`favicon → sidebarIcon → sidebarLogo → authLogo`) and finally to the
 * platform default. Only a slot that HAS a URL the browser cannot load is a
 * real problem, and only that should stand in the way of a save.
 */
import type { BrandAssetSlot } from './brand-assets';

/** Every slot the Branding page validates, in display order. */
export const BRAND_SLOT_ORDER: readonly BrandAssetSlot[] = [
  'auth', 'sidebar', 'sidebar-icon', 'favicon', 'report', 'report-mono',
];

export type BrandAssetStatus = 'idle' | 'validating' | 'valid' | 'empty' | 'invalid';

/**
 * Classify a slot from its resolved source and whether that source loaded.
 * `loaded` is ignored when there is no source — nothing was fetched.
 */
export function resolveAssetStatus(src: string | null | undefined, loaded: boolean): BrandAssetStatus {
  if (!src) return 'empty';
  return loaded ? 'valid' : 'invalid';
}

/** Does any slot hold a configured asset that will not load? */
export function assetsBlockSave(statuses: Iterable<BrandAssetStatus>): boolean {
  for (const status of statuses) {
    if (status === 'invalid') return true;
  }
  return false;
}

/** Is any slot still being checked? Transient, and separate from blocking. */
export function assetsAreValidating(statuses: Iterable<BrandAssetStatus>): boolean {
  for (const status of statuses) {
    if (status === 'validating') return true;
  }
  return false;
}

const STATUS_LABELS: Record<BrandAssetStatus, string> = {
  idle: 'Idle',
  validating: 'Checking',
  valid: 'Ready',
  // Not a warning: this surface intentionally uses the platform artwork.
  empty: 'Default',
  invalid: 'Broken asset',
};

export function assetStatusLabel(status: BrandAssetStatus): string {
  return STATUS_LABELS[status] ?? 'Idle';
}

/** Read across a slot map without caring how the caller keyed it. */
export function statusesOf(
  slots: readonly BrandAssetSlot[],
  read: (slot: BrandAssetSlot) => BrandAssetStatus,
): BrandAssetStatus[] {
  return slots.map(read);
}
