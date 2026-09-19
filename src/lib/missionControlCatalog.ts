/**
 * Frontend client for the Mission Control pricing catalog.
 * Reads via the `mission-control-catalog` edge function so the clone API key
 * never leaves the server. In-memory cache (5 min) keeps SPA navigations
 * cheap; pass `{ force: true }` to bypass.
 */
import { invokeSecureFunction } from "@/lib/secureInvoke";

export interface CatalogRole {
  slug: string;
  name: string;
  price_min_cents: number;
  price_max_cents: number;
  currency: string;
  permissions: string[];
}
export interface CatalogAddon {
  slug: string;
  name: string;
  price_min_cents: number;
  price_max_cents: number;
  currency?: string;
  billing_period: string;
  included_in_plans: string[];
  description?: string | null;
}
export interface CatalogSetup {
  slug: string;
  name: string;
  applies_to_plans: string[];
  deliverables: string[];
  price_cents?: number;
  currency?: string;
  description?: string | null;
}
export interface CatalogReport {
  slug: string;
  name: string;
  credit_cost: number;
  description?: string | null;
}
export interface MissionControlCatalog {
  roles: CatalogRole[];
  addons: CatalogAddon[];
  setups: CatalogSetup[];
  reports: CatalogReport[];
  fetched_at: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { value: MissionControlCatalog; expires: number } | null = null;
let inflight: Promise<MissionControlCatalog> | null = null;

export async function fetchCatalog(opts: { force?: boolean } = {}): Promise<MissionControlCatalog> {
  const now = Date.now();
  if (!opts.force && cache && cache.expires > now) return cache.value;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await invokeSecureFunction<MissionControlCatalog>(
        "mission-control-catalog",
        opts.force ? { force: true } : {},
      );
      if (error) throw new Error(error.message ?? "Failed to load pricing catalog");
      const value: MissionControlCatalog = data ?? {
        roles: [], addons: [], setups: [], reports: [], fetched_at: new Date(0).toISOString(),
      };
      cache = { value, expires: now + CACHE_TTL_MS };
      return value;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function getReportCreditCost(slug: string): Promise<number | null> {
  if (!slug) return null;
  try {
    const cat = await fetchCatalog();
    const hit = cat.reports.find((r) => r.slug === slug);
    return hit ? Number(hit.credit_cost) : null;
  } catch (e) {
    console.warn("[catalog] getReportCreditCost failed", e);
    return null;
  }
}

export async function getSeatRole(slug: string): Promise<CatalogRole | null> {
  if (!slug) return null;
  try {
    const cat = await fetchCatalog();
    return cat.roles.find((r) => r.slug === slug) ?? null;
  } catch {
    return null;
  }
}

/**
 * Catalog prices are TAX-INCLUSIVE — the figure already contains GST.
 *
 * Cents are kept whenever they are non-zero. Rounding to whole dollars hid
 * real amounts: a $5,443.20 annual plan rendered as $5,443, and every GST
 * component (a $699 plan contains $63.55) disappeared entirely.
 */
export function formatPriceRange(minCents: number, maxCents: number, currency = "AUD"): string {
  const fmt = (cents: number) =>
    new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency,
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  if (!minCents && !maxCents) return "—";
  if (minCents === maxCents) return fmt(minCents);
  return `${fmt(minCents)} – ${fmt(maxCents)}`;
}

export function invalidateCatalogCache() {
  cache = null;
}
