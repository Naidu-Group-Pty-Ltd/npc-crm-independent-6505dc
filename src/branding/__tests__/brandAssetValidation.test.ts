/**
 * The Branding page could not save a removal.
 *
 * Slot validation classified an empty slot as `invalid`, and the Save button
 * was gated on `status !== 'valid'` across every slot. So the moment a logo was
 * removed, saving was disabled — the draft cleared on screen, the row never
 * changed, and a tenant could never return to the platform's default artwork.
 *
 * Empty and broken are different things, and only one of them is a problem.
 */
import { describe, it, expect } from 'vitest';
import {
  assetStatusLabel,
  assetsAreValidating,
  assetsBlockSave,
  resolveAssetStatus,
  statusesOf,
  BRAND_SLOT_ORDER,
  type BrandAssetStatus,
} from '@/branding/brand-asset-validation';

describe('classifying a brand asset slot', () => {
  it('treats a slot with no source as empty, never invalid', () => {
    expect(resolveAssetStatus(null, false)).toBe('empty');
    expect(resolveAssetStatus(undefined, false)).toBe('empty');
    expect(resolveAssetStatus('', false)).toBe('empty');
  });

  it('treats a loadable source as valid', () => {
    expect(resolveAssetStatus('https://cdn.example.com/logo.png', true)).toBe('valid');
  });

  it('treats a configured but unloadable source as invalid', () => {
    expect(resolveAssetStatus('https://cdn.example.com/gone.png', false)).toBe('invalid');
  });
});

describe('what blocks a save', () => {
  it('does not block when every slot is empty', () => {
    // This is the exact state of "remove all branding to return to defaults".
    const statuses = BRAND_SLOT_ORDER.map(() => 'empty' as BrandAssetStatus);
    expect(assetsBlockSave(statuses)).toBe(false);
  });

  it('does not block when some slots are empty and others are fine', () => {
    expect(assetsBlockSave(['valid', 'empty', 'empty', 'valid'])).toBe(false);
  });

  it('blocks when a configured asset cannot be loaded', () => {
    expect(assetsBlockSave(['valid', 'empty', 'invalid'])).toBe(true);
  });

  it('does not treat idle or validating as a blocker', () => {
    // They are transient; `assetsAreValidating` handles the in-flight case
    // separately so a check in progress never reads as a broken asset.
    expect(assetsBlockSave(['idle', 'validating'])).toBe(false);
  });

  it('reports validation in flight independently of blocking', () => {
    expect(assetsAreValidating(['empty', 'validating'])).toBe(true);
    expect(assetsAreValidating(['empty', 'valid', 'invalid'])).toBe(false);
  });
});

describe('how a slot reads to the user', () => {
  it('labels an empty slot as using the default, not as a fault', () => {
    expect(assetStatusLabel('empty')).toBe('Default');
  });

  it('names a genuinely broken asset', () => {
    expect(assetStatusLabel('invalid')).toBe('Broken asset');
  });

  it('labels the healthy and transient states', () => {
    expect(assetStatusLabel('valid')).toBe('Ready');
    expect(assetStatusLabel('validating')).toBe('Checking');
    expect(assetStatusLabel('idle')).toBe('Idle');
  });
});

describe('reading across the slot map', () => {
  it('preserves slot order so the caller can pair statuses back up', () => {
    const statuses = statusesOf(BRAND_SLOT_ORDER, (slot) =>
      slot === 'favicon' ? 'invalid' : 'empty',
    );
    expect(statuses).toHaveLength(BRAND_SLOT_ORDER.length);
    expect(statuses[BRAND_SLOT_ORDER.indexOf('favicon')]).toBe('invalid');
    expect(assetsBlockSave(statuses)).toBe(true);
  });
});
