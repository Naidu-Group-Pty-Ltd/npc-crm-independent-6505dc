/**
 * AML V3 · Phase 12 — Legacy alias local telemetry.
 *
 * Purpose: give operators a lightweight, tenant-safe signal of how often
 * legacy /admin/aml/{verification,screening,risk,finance,...} routes are
 * still being visited *from this browser* while the V3 cutover flags are
 * being flipped. Zero backend, zero PII — stored in localStorage under
 * `aml:v3:legacy_hits`.
 *
 * This is intentionally per-browser and read-only in the Cutover Console.
 * A future phase can promote this to a server-side rollup once the
 * organisation asks for tenant-wide adoption analytics.
 */

const KEY = "aml:v3:legacy_hits";
const MAX_HITS = 500;

export interface LegacyHit {
  path: string;
  label: string;
  t: number; // epoch ms
}

function safeRead(): LegacyHit[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((h) => h && typeof h.path === "string") : [];
  } catch {
    return [];
  }
}

function safeWrite(hits: LegacyHit[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(hits.slice(-MAX_HITS)));
  } catch {
    /* ignore quota */
  }
}

export function recordLegacyAliasHit(path: string, label: string) {
  if (typeof window === "undefined") return;
  const hits = safeRead();
  hits.push({ path, label, t: Date.now() });
  safeWrite(hits);
}

export interface LegacyHitSummary {
  path: string;
  label: string;
  count: number;
  lastSeen: number;
}

export function readLegacyAliasSummary(): LegacyHitSummary[] {
  const hits = safeRead();
  const byPath = new Map<string, LegacyHitSummary>();
  for (const h of hits) {
    const existing = byPath.get(h.path);
    if (existing) {
      existing.count += 1;
      if (h.t > existing.lastSeen) existing.lastSeen = h.t;
    } else {
      byPath.set(h.path, { path: h.path, label: h.label, count: 1, lastSeen: h.t });
    }
  }
  return Array.from(byPath.values()).sort((a, b) => b.count - a.count);
}

export function clearLegacyAliasHits() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function totalLegacyAliasHits(): number {
  return safeRead().length;
}
