/**
 * Emits the support knowledge base from the User Guide's single content
 * source, `src/lib/userGuideContent.ts`, into `support-kb/user-guide-kb.json`
 * for the support assistant to ingest.
 *
 * Run:  npm run support:kb          (commit the regenerated file)
 *
 * One chunk per guide item plus an overview chunk per section, plus one chunk
 * per standalone card (Quick Tips, Property Status Guide, Need Help). Every
 * chunk carries the anchor that deep-links back into the app —
 * `/user-guide#section-<id>` for sections, `/user-guide#<id>` for the cards —
 * resolved by the hash handler in `src/pages/UserGuide.tsx`.
 *
 * Output is deterministic (source order, no randomness) except `generated_at`,
 * so `src/lib/__tests__/userGuideKb.spec.ts` can fail when the committed file
 * drifts from the content module.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXTRA_GUIDE_CARDS,
  GUIDE_SECTIONS,
  type GuideItem,
} from '../../src/lib/userGuideContent';

export interface KbChunk {
  id: string;
  section_id: string;
  section_title: string;
  anchor: string;
  title: string;
  content: string;
  keywords: string[];
}

export interface UserGuideKb {
  version: 1;
  source: string;
  generated_at: string;
  default_base_url: string;
  chunks: KbChunk[];
}

/** Words too common in this corpus to distinguish anything. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'your', 'from', 'into', 'that', 'this',
  'all', 'any', 'are', 'can', 'how', 'not', 'off', 'one', 'out', 'per',
  'use', 'using', 'via', 'you', 'what', 'when', 'where',
]);

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Lowercased distinctive words from titles, in first-seen order. */
function keywordsFrom(...titles: string[]): string[] {
  const words: string[] = [];
  for (const title of titles) {
    for (const word of title.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length < 3 || STOPWORDS.has(word)) continue;
      if (!words.includes(word)) words.push(word);
    }
  }
  return words;
}

/** Flatten one guide item to plain, newline-joined text. */
function itemContent(item: GuideItem): string {
  const lines = [item.description];
  if (item.features?.length) {
    lines.push(`Features: ${item.features.join('; ')}`);
  }
  if (item.steps?.length) {
    lines.push(`Steps: ${item.steps.map((step, i) => `${i + 1}. ${step}`).join(' ')}`);
  }
  if (item.tips?.length) {
    lines.push(`Tips: ${item.tips.join('; ')}`);
  }
  for (const shortcut of item.shortcuts ?? []) {
    lines.push(`Shortcut: ${shortcut.keys.join('+')} — ${shortcut.description}`);
  }
  return lines.join('\n');
}

/** Build the whole knowledge base in memory. Pure apart from the timestamp. */
export function buildKb(generatedAt: string = new Date().toISOString()): UserGuideKb {
  const chunks: KbChunk[] = [];

  for (const section of GUIDE_SECTIONS) {
    chunks.push({
      id: `${section.id}/overview`,
      section_id: section.id,
      section_title: section.title,
      anchor: `section-${section.id}`,
      title: section.title,
      content: [
        section.description,
        `Topics: ${section.items.map((item) => item.title).join('; ')}`,
      ].join('\n'),
      keywords: keywordsFrom(section.title, ...section.items.map((item) => item.title)),
    });

    // Slugs are per-section; a repeated item title gets a numeric suffix so
    // chunk ids stay unique without depending on array positions.
    const used = new Set(['overview']);
    for (const item of section.items) {
      let slug = slugify(item.title) || 'item';
      if (used.has(slug)) {
        let n = 2;
        while (used.has(`${slug}-${n}`)) n += 1;
        slug = `${slug}-${n}`;
      }
      used.add(slug);

      chunks.push({
        id: `${section.id}/${slug}`,
        section_id: section.id,
        section_title: section.title,
        anchor: `section-${section.id}`,
        title: item.title,
        content: itemContent(item),
        keywords: keywordsFrom(section.title, item.title),
      });
    }
  }

  for (const card of EXTRA_GUIDE_CARDS) {
    chunks.push({
      id: card.id,
      section_id: card.id,
      section_title: card.title,
      anchor: card.id,
      title: card.title,
      content: card.entries.map((entry) => `${entry.title}: ${entry.body}`).join('\n'),
      keywords: keywordsFrom(card.title, ...card.entries.map((entry) => entry.title)),
    });
  }

  return {
    version: 1,
    source: 'npc-property-dashbord/src/lib/userGuideContent.ts',
    generated_at: generatedAt,
    default_base_url: 'https://npcservices.com.au',
    chunks,
  };
}

// Write only when executed directly (`npm run support:kb`) — the drift test
// imports buildKb from this module and must not rewrite the file as a side
// effect of importing it.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMain) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const outFile = resolve(repoRoot, 'support-kb', 'user-guide-kb.json');
  const kb = buildKb();
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(kb, null, 2)}\n`);
  console.log(`Wrote ${outFile} (${kb.chunks.length} chunks)`);
}
