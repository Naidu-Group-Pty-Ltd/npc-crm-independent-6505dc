/**
 * The property register, read for choosing the building an assessment concerns.
 *
 * Both registers — `commercial_properties` and `industrial_properties` — as one
 * list, because the Properties tab shows them as one list and an adviser does
 * not think of a building by the table it was filed in. The rows are kept, not
 * just their labels: the prefill is built from the row that was chosen, so
 * choosing a building costs no second request.
 *
 * Starting an assessment OF a building — from its register row or its own
 * page — already knows which one, so `readRegisterProperty` reads that row
 * alone rather than both registers to find it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { commercialApi, type CommercialProperty } from '@/hooks/useCommercialProperties';
import { industrialApi, type IndustrialProperty } from '@/hooks/useIndustrialProperties';
import type { CalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import {
  buildCommercialPrefill, buildIndustrialPrefill, commercialOption, industrialOption, linkFor,
  type RegisterDomain, type RegisterPropertyLink, type RegisterPropertyOption,
} from '@/lib/ciAssessment/registerProperty';

export interface ResolvedRegisterProperty {
  option: RegisterPropertyOption;
  prefill: CalculatorPrefill;
  link: RegisterPropertyLink;
}

/** A value for a `<select>` that names both the register and the row. */
export function optionKey(option: Pick<RegisterPropertyOption, 'domain' | 'propertyId'>): string {
  return `${option.domain}:${option.propertyId}`;
}

export function useRegisterProperties(enabled: boolean) {
  const [commercial, setCommercial] = useState<CommercialProperty[]>([]);
  const [industrial, setIndustrial] = useState<IndustrialProperty[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void Promise.all([commercialApi.listProperties(), industrialApi.listProperties()]).then(([c, i]) => {
      if (cancelled) return;
      setCommercial((c.data ?? []) as CommercialProperty[]);
      setIndustrial((i.data ?? []) as IndustrialProperty[]);
      // Either register failing is said, not hidden behind a shorter list.
      setError(c.error?.message ?? i.error?.message ?? null);
      setReady(true);
    });
    return () => { cancelled = true; setReady(false); };
  }, [enabled]);

  /**
   * Loading from the first render it is enabled — not from the effect after
   * it. A caller that decides something once the register has loaded (the
   * dialog preselecting the building it was opened for) otherwise reads "not
   * loading" before the request has even started, and decides on an empty list.
   */
  const loading = enabled && !ready;

  const options = useMemo<RegisterPropertyOption[]>(() => [
    ...commercial.map(commercialOption),
    ...industrial.map(industrialOption),
  ].sort((a, b) => a.label.localeCompare(b.label, 'en-AU', { sensitivity: 'base' })), [commercial, industrial]);

  /** Resolve a chosen row to its prefill and the link the assessment records. */
  const resolve = useCallback((domain: RegisterDomain, propertyId: string): ResolvedRegisterProperty | null => {
    if (domain === 'commercial') {
      const row = commercial.find((property) => property.id === propertyId);
      return row ? resolveCommercial(row) : null;
    }
    const row = industrial.find((property) => property.id === propertyId);
    return row ? resolveIndustrial(row) : null;
  }, [commercial, industrial]);

  return { options, loading, error, resolve };
}

function resolveCommercial(row: CommercialProperty): ResolvedRegisterProperty {
  const option = commercialOption(row);
  return { option, prefill: buildCommercialPrefill(row), link: linkFor(option) };
}

function resolveIndustrial(row: IndustrialProperty): ResolvedRegisterProperty {
  const option = industrialOption(row);
  return { option, prefill: buildIndustrialPrefill(row), link: linkFor(option) };
}

/**
 * One building, read on its own, with its prefill and link.
 *
 * `null` data is always paired with the reason, because a building that could
 * not be read is not a building that is absent, and whoever asked for an
 * assessment of it should be told which.
 */
export async function readRegisterProperty(
  domain: RegisterDomain,
  propertyId: string,
): Promise<{ data: ResolvedRegisterProperty | null; error: string | null }> {
  if (domain === 'commercial') {
    const result = await commercialApi.getProperty(propertyId);
    if (result.error) return { data: null, error: result.error.message };
    const row = result.data as CommercialProperty | null;
    return row ? { data: resolveCommercial(row), error: null } : { data: null, error: NOT_IN_REGISTER };
  }
  const result = await industrialApi.getProperty(propertyId);
  if (result.error) return { data: null, error: result.error.message };
  const row = result.data as IndustrialProperty | null;
  return row ? { data: resolveIndustrial(row), error: null } : { data: null, error: NOT_IN_REGISTER };
}

const NOT_IN_REGISTER = 'That property is no longer in your register.';
