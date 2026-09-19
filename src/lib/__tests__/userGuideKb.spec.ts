/**
 * Integrity of the committed support knowledge base
 * (`support-kb/user-guide-kb.json`).
 *
 * The file is generated from `src/lib/userGuideContent.ts` by
 * `scripts/support/extractUserGuideKb.ts` and ingested by the support
 * assistant, which answers with deep links back into the app. Two failure
 * modes matter: a chunk whose anchor does not resolve on the guide page sends
 * a customer somewhere that scrolls nowhere, and a committed file that lags
 * the content module answers from documentation the product no longer shows.
 * Regenerate with `npm run support:kb`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDE_SECTIONS, STANDALONE_GUIDE_CARD_IDS } from '../userGuideContent';
import { buildKb, type UserGuideKb } from '../../../scripts/support/extractUserGuideKb';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const kb = JSON.parse(
  readFileSync(join(REPO_ROOT, 'support-kb', 'user-guide-kb.json'), 'utf8'),
) as UserGuideKb;

describe('support knowledge base envelope', () => {
  it('has the shape the support assistant ingests', () => {
    expect(kb.version).toBe(1);
    expect(kb.source).toBe('npc-property-dashbord/src/lib/userGuideContent.ts');
    expect(typeof kb.generated_at).toBe('string');
    expect(Number.isNaN(Date.parse(kb.generated_at))).toBe(false);
    expect(kb.default_base_url).toBe('https://npcservices.com.au');
    expect(Array.isArray(kb.chunks)).toBe(true);
  });

  it('carries at least 60 chunks', () => {
    expect(kb.chunks.length).toBeGreaterThanOrEqual(60);
  });
});

describe('chunk integrity', () => {
  it('chunk ids are unique', () => {
    const ids = kb.chunks.map((chunk) => chunk.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every chunk has substantive content', () => {
    for (const chunk of kb.chunks) {
      // Overview chunks (`<section>/overview`) and standalone-card chunks (no
      // slash) summarise; item chunks carry the full flattened prose.
      const isSummary = chunk.id.endsWith('/overview') || !chunk.id.includes('/');
      const min = isSummary ? 20 : 40;
      expect(
        chunk.content.trim().length,
        `chunk ${chunk.id} content is under ${min} chars`,
      ).toBeGreaterThanOrEqual(min);
    }
  });

  it('every anchor resolves on the user guide page', () => {
    const sectionIds = new Set(GUIDE_SECTIONS.map((section) => section.id));
    const cardIds = new Set<string>(STANDALONE_GUIDE_CARD_IDS);
    for (const chunk of kb.chunks) {
      const sectionMatch = /^section-(.+)$/.exec(chunk.anchor);
      const resolves = sectionMatch
        ? sectionIds.has(sectionMatch[1])
        : cardIds.has(chunk.anchor);
      expect(
        resolves,
        `chunk ${chunk.id} anchor "${chunk.anchor}" matches no rendered section or card`,
      ).toBe(true);
    }
  });
});

describe('committed file tracks the content module', () => {
  it('regenerating in memory yields the same chunk ids (run `npm run support:kb`)', () => {
    const fresh = buildKb(kb.generated_at);
    expect(fresh.chunks.map((chunk) => chunk.id)).toEqual(kb.chunks.map((chunk) => chunk.id));
  });
});
