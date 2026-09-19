/**
 * Semantic placeholder detection (advisor-plan Phase 4).
 *
 * Scans imported text overlays for NPC report values — addresses, suburbs,
 * purchase prices, weekly rents, yields, client-name placeholders — and
 * suggests converting the static text into dynamic `{{bindings}}` against the
 * canonical sample-data paths (`property.address`, `financials.weeklyRent`, …)
 * so an imported design becomes a REUSABLE report template.
 *
 * Pure + unit-tested. Detection is conservative: each suggestion carries a
 * confidence, applying is opt-in, and overlays that already contain bindings
 * are skipped.
 */
import type { Page, ReportTemplate } from '../templateSchema';

export interface PlaceholderSuggestion {
  pageId: string;
  blockId: string;
  overlayId: string;
  /** Exact source substring that would be replaced. */
  matchText: string;
  /** Canonical binding path (matches sampleDataPresets). */
  path: string;
  /** Human label for the review UI. */
  label: string;
  confidence: number;
  /** Overlay content after the swap (binding token in place of the match). */
  replacementContent: string;
}

const AU_STATES = '(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)';
const MAX_ADDRESS_LINE_LENGTH = 256;

// Imported overlay text is attacker-controlled. Keep address matching to a
// realistic, fixed-size line and use bounded components so near misses cannot
// trigger unbounded regexp backtracking on the browser's main thread.
const ADDRESS_PATTERN = new RegExp(
  String.raw`\b(?:Lot\s+\d{1,8}[A-Za-z]?\s+)?(?:\d{1,6}[A-Za-z]?\s+)?[A-Z][\w'’.-]{0,40}(?:\s+[\w'’.-]{1,40}){0,8}\s+(?:St(?:reet)?|R(?:oa)?d|Ave(?:nue)?|Dr(?:ive)?|C(?:our)?t|Cres(?:cent)?|Pl(?:ace)?|Lane|Ln|Blvd|Way|Terrace|Tce|Estate|Close|Parade|Circuit)\b[^,\n]{0,80},?\s+[A-Z][\w'’.-]{1,40}(?:\s+[\w'’.-]{1,40}){0,5},?\s+${AU_STATES}\s+\d{4}\b`,
);

interface Rule {
  path: string;
  label: string;
  confidence: (overlayText: string) => number;
  /** Returns [matchText, bindingToken] or null. */
  match: (text: string) => { matchText: string; token: string } | null;
}

const hasContext = (text: string, words: RegExp) => words.test(text);

const RULES: Rule[] = [
  {
    path: 'client.name',
    label: 'Client name',
    confidence: () => 0.95,
    match: (text) => {
      const m = /\[(?:client(?:\s+name)?|name|recipient)\]/i.exec(text);
      return m ? { matchText: m[0], token: '{{client.name}}' } : null;
    },
  },
  {
    path: 'property.address',
    label: 'Property address',
    confidence: () => 0.9,
    match: (text) => {
      // "12 Bondi Avenue, Bondi Beach NSW 2026" / "Lot 60941 Cloverton Estate, Kalkallo VIC 3064"
      for (const line of text.split(/\r?\n/)) {
        if (line.length > MAX_ADDRESS_LINE_LENGTH) continue;
        const m = ADDRESS_PATTERN.exec(line);
        if (m) return { matchText: m[0].trim(), token: '{{property.address}}' };
      }
      return null;
    },
  },
  {
    path: 'property.suburb',
    label: 'Suburb',
    confidence: () => 0.8,
    match: (text) => {
      // Suburb-only location line: "Kalkallo, VIC 3064" (no street part).
      const m = new RegExp(String.raw`(^|\n)\s*([A-Z][\w'’ ]{2,}?),?\s+${AU_STATES}\s+\d{4}\s*($|\n)`).exec(text);
      if (!m) return null;
      const suburb = m[2].trim();
      // A leading street number means the address rule owns this line.
      if (/\d/.test(suburb)) return null;
      return { matchText: suburb, token: '{{property.suburb}}' };
    },
  },
  {
    path: 'financials.weeklyRent',
    label: 'Weekly rent',
    confidence: () => 0.9,
    match: (text) => {
      const m = /\$\s?([\d,]+(?:\.\d+)?)\s*(?:\/\s*|\bper\s+)(?:wk|week)\b/i.exec(text);
      return m ? { matchText: m[1], token: '{{financials.weeklyRent}}' } : null;
    },
  },
  {
    path: 'financials.purchasePrice',
    label: 'Purchase price',
    confidence: (text) => (hasContext(text, /price|purchase|investment|value|total/i) ? 0.85 : 0.55),
    match: (text) => {
      // Big money: $590,000+ (weekly-rent amounts never reach 5 digits).
      const m = /\$\s?(\d{1,3}(?:,\d{3})+|\d{6,})\b/.exec(text);
      if (!m) return null;
      if (/(?:\/\s*|\bper\s+)(?:wk|week)\b/i.test(text.slice((m.index ?? 0)))) return null; // owned by rent rule
      return { matchText: m[1], token: '{{financials.purchasePrice}}' };
    },
  },
  {
    path: 'financials.yield',
    label: 'Gross yield',
    confidence: () => 0.85,
    match: (text) => {
      if (!hasContext(text, /yield/i)) return null;
      const m = /\b(\d{1,2}(?:\.\d+)?)\s?%/.exec(text);
      return m ? { matchText: m[1], token: '{{financials.yield}}' } : null;
    },
  },
];

/** Scan a template's text overlays for dynamic-field candidates. */
export function detectPlaceholderSuggestions(template: ReportTemplate): PlaceholderSuggestion[] {
  const out: PlaceholderSuggestion[] = [];
  for (const page of template.pages as Page[]) {
    for (const block of page.blocks) {
      for (const overlay of block.overlays ?? []) {
        if (overlay.type !== 'text' || overlay.hidden) continue;
        const content = String(overlay.content ?? '');
        if (!content.trim() || content.includes('{{')) continue;
        const seenPaths = new Set<string>();
        for (const rule of RULES) {
          if (seenPaths.has(rule.path)) continue;
          const hit = rule.match(content);
          if (!hit || !content.includes(hit.matchText)) continue;
          // Rich-text runs: only convertible when one run contains the match
          // verbatim (the renderer paints runs, not content, when present).
          if (Array.isArray((overlay as any).runs) && (overlay as any).runs.length
              && !(overlay as any).runs.some((r: any) => String(r.text ?? '').includes(hit.matchText))) {
            continue;
          }
          seenPaths.add(rule.path);
          out.push({
            pageId: page.id,
            blockId: block.id,
            overlayId: overlay.id,
            matchText: hit.matchText,
            path: rule.path,
            label: rule.label,
            confidence: rule.confidence(content),
            replacementContent: content.replace(hit.matchText, hit.token),
          });
        }
      }
    }
  }
  return out;
}

/** Apply accepted suggestions: swap matched text for binding tokens. */
export function applyPlaceholderSuggestions(
  template: ReportTemplate,
  suggestions: PlaceholderSuggestion[],
): { template: ReportTemplate; applied: number } {
  if (!suggestions.length) return { template, applied: 0 };
  const byOverlay = new Map<string, PlaceholderSuggestion[]>();
  for (const s of suggestions) {
    byOverlay.set(s.overlayId, [...(byOverlay.get(s.overlayId) ?? []), s]);
  }
  let applied = 0;
  const pages = (template.pages as Page[]).map((page) => ({
    ...page,
    blocks: page.blocks.map((block) => ({
      ...block,
      overlays: (block.overlays ?? []).map((overlay) => {
        const todo = byOverlay.get(overlay.id);
        if (!todo || overlay.type !== 'text') return overlay;
        let content = String(overlay.content ?? '');
        let runs = Array.isArray((overlay as any).runs) ? [...(overlay as any).runs] : undefined;
        for (const s of todo) {
          if (!content.includes(s.matchText)) continue;
          content = content.replace(s.matchText, `{{${s.path}}}`);
          if (runs) {
            runs = runs.map((r: any) => String(r.text ?? '').includes(s.matchText)
              ? { ...r, text: String(r.text).replace(s.matchText, `{{${s.path}}}`) }
              : r);
          }
          applied++;
        }
        return { ...overlay, content, ...(runs ? { runs } : {}) } as typeof overlay;
      }),
    })),
  }));
  return { template: { ...template, pages } as ReportTemplate, applied };
}
