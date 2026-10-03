/**
 * THE COMMAND CENTRE DRAWS THE NETWORK'S PLAN — it plans nothing itself.
 *
 * A mirror row holds no network storage path: its picture is the network's
 * own door (`external_url`) and its `source_detail` is what the network's
 * payload composer sent, which since `20261001140000` includes the plan beside
 * the fingerprints it is keyed on. These tests run the Command Centre's own
 * reader over mirror-shaped rows (synthetic pictures only).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { heroPlanOfImage, servedObjectOf } from '../../../supabase/functions/_shared/builderStock/primaryImage';
import { HERO_PLAN_KEY, planHero } from '../../../supabase/functions/_shared/builderStock/marketplaceHero.pure';
import { drawScene } from './fixtures/heroScenes';

const plan = planHero(drawScene({ width: 320, height: 400, horizon: 330,
  houses: [{ x: 70, w: 180, roofTop: 250, base: 340 }] }).thumbnail)!;
const ORIGINAL = 'a'.repeat(64);

const mirrorRow = (detail: Record<string, unknown>) => ({
  id: 'img-1', source_stage: 'uploaded_document', verification_status: 'source_supplied',
  processing_status: 'ready', storage_path: null,
  external_url: 'https://network.example/functions/v1/builder-network-stock-image?id=img-1',
  position: 0,
  source_detail: {
    role: 'primary_property', role_evidence_level: 1, stored_sha256: ORIGINAL,
    marketplace_display_eligible: true, marketplace_eligibility_state: 'eligible', ...detail,
  },
});

describe('a mirror row reads the plan by fingerprint, never by path', () => {
  it('the network plan for the original is drawn on the mirror', () => {
    const row = mirrorRow({ [HERO_PLAN_KEY]: { plan, object: 'original', sha256: ORIGINAL, planned_at: 'x' } });
    expect(servedObjectOf(row as never)).toEqual({ object: 'original', sha256: ORIGINAL });
    expect(heroPlanOfImage(row as never)).toEqual(plan);
  });

  it('a plan for other bytes, another object or an older version is not drawn', () => {
    expect(heroPlanOfImage(mirrorRow({ [HERO_PLAN_KEY]: { plan, object: 'original', sha256: 'b'.repeat(64), planned_at: 'x' } }) as never)).toBeNull();
    expect(heroPlanOfImage(mirrorRow({ [HERO_PLAN_KEY]: { plan, object: 'derivative', sha256: ORIGINAL, planned_at: 'x' } }) as never)).toBeNull();
    expect(heroPlanOfImage(mirrorRow({ [HERO_PLAN_KEY]: { plan: { ...plan, version: 0 }, object: 'original', sha256: ORIGINAL, planned_at: 'x' } }) as never)).toBeNull();
    expect(heroPlanOfImage(mirrorRow({}) as never)).toBeNull();
  });

  it('the image door answers the plan beside the URL, on both of its branches', () => {
    const door = readFileSync(resolve(__dirname, '../../../supabase/functions/builder-stock-marketplace/index.ts'), 'utf8');
    expect(door.match(/hero: heroPlanOfImage\(image as DisplayableImage\)/g)?.length).toBe(2);
  });

  it('only the card surfaces opt in; the property gallery keeps the picture whole', () => {
    const read = (p: string) => readFileSync(resolve(__dirname, '../../..', p), 'utf8');
    expect(read('src/components/listings/BuilderStockTab.tsx')).toMatch(/presentation="card"/);
    expect(read('src/pages/BuilderPortal.tsx')).toMatch(/presentation="card"/);
    expect(read('src/components/listings/BuilderStockGallery.tsx')).not.toMatch(/presentation="card"/);
  });
});

describe('planner v3 crosses to the Command Centre', () => {
  const sha = 'a'.repeat(64);
  const row = (plan: unknown) => ({
    id: 'img', position: 0, source_stage: 'uploaded_document', verification_status: 'source_supplied',
    processing_status: 'ready', storage_path: null, external_url: 'https://network.invalid/x',
    source_detail: { stored_sha256: sha, [HERO_PLAN_KEY]: { plan, object: 'original', sha256: sha, planned_at: 'x' } },
  });
  const scene = drawScene({ width: 400, height: 110, horizon: 80, seed: 3,
    houses: [{ x: 20, w: 360, roofTop: 30, base: 86, garage: true }] });

  it('a v3 fit, with its reason, is drawn here exactly as the network stored it', () => {
    const v3 = planHero(scene.thumbnail, undefined, { rescue: true })!;
    expect(v3.version).toBe(3);
    expect(v3.mode).toBe('fit');
    expect(v3.fitReason).toBe('building_too_wide');
    // The payload composer strips nulls in transit; the plan must still read.
    const stripped = JSON.parse(JSON.stringify(v3, (_k, v) => (v === null ? undefined : v)));
    expect(heroPlanOfImage(row(stripped) as never)).not.toBeNull();
  });

  it('a stale v2 plan still draws here until the network re-plans it', () => {
    const v2 = planHero(scene.thumbnail, undefined, { rescue: false })!;
    expect(v2.version).toBe(2);
    expect(heroPlanOfImage(row(v2) as never)).not.toBeNull();
  });
});
