import { useEffect, useState, useCallback } from "react";
import { amlTenantApi } from "./amlTenantApi";

/**
 * Phase 12 — Tenant terminology resolver.
 *
 * Reads `tenant_settings.terminology_overrides` and returns a `t(label)` helper
 * that swaps display strings when an override exists. The edge function already
 * drops any locked regulatory term (AUSTRAC, SMR, MLRO, …) before persisting,
 * so callers can trust that overrides never rename compliance controls.
 *
 * The result is cached in-memory and in sessionStorage so navigation between
 * AML workspaces does not re-hit the edge function.
 */

const CACHE_KEY = "aml:terminology_overrides:v1";
type OverrideMap = Record<string, string>;

let memory: OverrideMap | null = null;
const subscribers = new Set<(m: OverrideMap) => void>();

/**
 * Coerce whatever the tenant endpoint returned into a usable map.
 *
 * A tenant with no overrides, a partial response, or an older function version
 * can all leave `terminology_overrides` absent. That used to flow through
 * `writeCache` into the `overrides` state as `undefined`, so the very next
 * `t('AML/CTF')` threw and the ErrorBoundary replaced the whole Command Center
 * with "Something went wrong" — every AML surface, because `AmlLayout` calls
 * `t`. Found by the staff browser journey. Coercing at the boundary is the fix;
 * `t` is defensive as well so no future caller can white-screen the module.
 */
function asOverrideMap(value: unknown): OverrideMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: OverrideMap = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') out[key] = raw;
  }
  return out;
}

function readCache(): OverrideMap {
  if (memory) return memory;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) { memory = asOverrideMap(JSON.parse(raw)); return memory; }
  } catch { /* ignore */ }
  return {};
}
function writeCache(next: unknown) {
  const map = asOverrideMap(next);
  memory = map;
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
  subscribers.forEach((fn) => fn(map));
}

export async function refreshAmlTerminology(): Promise<OverrideMap> {
  try {
    const { terminology_overrides: next } = await amlTenantApi.terminology();
    const map = asOverrideMap(next);
    writeCache(map);
    return map;
  } catch {
    return readCache();
  }
}

export function useAmlTerminology() {
  const [overrides, setOverrides] = useState<OverrideMap>(() => readCache());

  useEffect(() => {
    const listener = (m: OverrideMap) => setOverrides(m);
    subscribers.add(listener);
    if (!memory) { refreshAmlTerminology(); }
    return () => { subscribers.delete(listener); };
  }, []);

  const t = useCallback(
    (label: string) => overrides?.[label] ?? label,
    [overrides],
  );

  return { t, overrides, refresh: refreshAmlTerminology };
}
