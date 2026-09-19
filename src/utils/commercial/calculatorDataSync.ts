import type { CalculatorSourceMode, CalculatorTabKey, CommercialIndustrialDealProfile } from './commercialDealState';

export interface SyncedField<T> { value: T; mode: CalculatorSourceMode; isGlobal: boolean; isOverride: boolean; message: string; }

export function resolveSyncedField<T>(profile: CommercialIndustrialDealProfile, tab: CalculatorTabKey, fieldKey: string, globalValue: T, mode: CalculatorSourceMode): SyncedField<T> {
  const override = profile.scenarioOverrides[tab]?.[fieldKey] as T | undefined;
  if (mode === 'global') return { value: globalValue, mode, isGlobal: true, isOverride: false, message: 'Using Global Deal Inputs — edits update the shared deal profile.' };
  return { value: override ?? globalValue, mode, isGlobal: false, isOverride: override !== undefined, message: 'Manual Override / Scenario Mode — edits remain tab-specific unless pushed to global.' };
}

export function buildGlobalSyncLabel(mode: CalculatorSourceMode): string {
  return mode === 'global' ? 'Global Input Sync: On' : mode === 'manualOverride' ? 'Manual Override Active' : mode === 'aiPending' ? 'AI Estimate Pending' : mode === 'savedPropertyLinked' ? 'Saved Property Linked' : 'Scenario Override Active';
}
