/**
 * The brochure's photographs, from the moment a PDF is parsed to the moment
 * the report exists to file them under.
 *
 * Three moments, one hook, so the report generator carries three calls and
 * none of the bookkeeping:
 *
 *  - `begin(file)` starts reading the brochure's pictures as soon as its pages
 *    are rendered, beside the parse, so they are usually ready before the
 *    parse answers. A new file, a re-parse or a removed file starts again.
 *  - `settle(parts)` runs once the parse has named the property: the pages are
 *    read for it, the offer is made, and the lead photograph and the property's
 *    floor plans are ticked. Nothing is ticked where the address cannot vouch
 *    for one property.
 *  - `filingArgs()` is what the generator hands `fileChosenBrochurePhotographs`
 *    once the report row exists, or null where nothing is ticked.
 *
 * A reading superseded by a later one is dropped however late it finishes,
 * and every preview URL is revoked when it is no longer shown.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  brochurePropertyIdentity,
  MAX_BROCHURE_PLAN_OFFER,
  offerBrochurePhotographs,
  readBrochurePage,
  type BrochureCandidate,
  type BrochureOffer,
} from '@/lib/reports/brochurePhotographs.pure';
import {
  readBrochurePhotographs,
  type BrochurePhotographFile,
  type BrochureReading,
} from '@/lib/reports/brochurePhotographs';
import type { BrochurePickerStatus } from '@/components/reports/BrochurePhotographsPicker';
import {
  brochurePhotographSource,
  REPORT_FLOOR_PLAN_LIMIT,
  type PhotographSource,
} from '../../supabase/functions/_shared/reportPhotographs.pure';

export interface BrochurePhotographsState {
  status: BrochurePickerStatus;
  offer: BrochureOffer | null;
  previews: Map<string, string>;
  selected: Set<string>;
  /** The floor plans ticked, by candidate key. */
  selectedPlans: Set<string>;
  /** The address the brochure states; null where it names no street and suburb. */
  source: PhotographSource | null;
  reading: BrochureReading | null;
}

export interface BrochureFilingArgs {
  documentSha256: string;
  source: PhotographSource;
  offered: readonly BrochureCandidate[];
  ticked: ReadonlySet<string>;
  plans: readonly BrochureCandidate[];
  tickedPlans: ReadonlySet<string>;
  files: ReadonlyMap<string, BrochurePhotographFile>;
}

/** What to file, from a settled state; null where there is nothing to file. */
export function brochureFilingArgs(state: BrochurePhotographsState | null): BrochureFilingArgs | null {
  if (!state || state.status !== 'ready' || !state.reading || !state.offer || !state.source) return null;
  const files = state.reading.files;
  const ticked = new Set([...state.selected].filter((key) => files.has(key)));
  const tickedPlans = new Set([...state.selectedPlans].filter((key) => files.has(key)));
  if (!ticked.size && !tickedPlans.size) return null;
  return {
    documentSha256: state.reading.documentSha256,
    source: state.source,
    offered: state.offer.offered,
    ticked,
    plans: state.offer.plans,
    tickedPlans,
    files,
  };
}

export function useBrochurePhotographs(
  read: (file: File) => Promise<BrochureReading> = readBrochurePhotographs,
) {
  const [state, setState] = useState<BrochurePhotographsState | null>(null);
  const runRef = useRef(0);
  const pendingRef = useRef<Promise<BrochureReading | null> | null>(null);
  const urlsRef = useRef<string[]>([]);
  const stateRef = useRef<BrochurePhotographsState | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const revoke = useCallback(() => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
  }, []);

  useEffect(() => () => revoke(), [revoke]);

  const reset = useCallback(() => {
    runRef.current += 1;
    pendingRef.current = null;
    revoke();
    setState(null);
  }, [revoke]);

  const begin = useCallback((file: File) => {
    reset();
    pendingRef.current = read(file).catch((error: unknown) => {
      console.warn('The brochure\'s photographs could not be read:', error instanceof Error ? error.message : error);
      return null;
    });
  }, [read, reset]);

  const settle = useCallback((parts: { address?: unknown; suburb?: unknown }) => {
    const pending = pendingRef.current;
    if (!pending) return;
    const run = runRef.current;
    const source = brochurePhotographSource(parts);
    const identity = brochurePropertyIdentity(typeof parts.address === 'string' ? parts.address : null);
    const empty = { offer: null, previews: new Map<string, string>(), selected: new Set<string>(), selectedPlans: new Set<string>(), reading: null };
    setState({ status: 'reading', ...empty, source });
    void pending.then((reading) => {
      if (runRef.current !== run) return;
      if (!reading) {
        setState({ status: 'failed', ...empty, source });
        return;
      }
      const offer = offerBrochurePhotographs(
        reading.candidates,
        reading.pageTexts.map((text) => readBrochurePage(text, identity)),
      );
      revoke();
      const previews = new Map<string, string>();
      for (const candidate of [...offer.offered, ...offer.plans.slice(0, MAX_BROCHURE_PLAN_OFFER)]) {
        const file = reading.files.get(candidate.key);
        if (!file) continue;
        const url = URL.createObjectURL(file.blob);
        urlsRef.current.push(url);
        previews.set(candidate.key, url);
      }
      const selected = new Set(source && offer.lead && previews.has(offer.lead) ? [offer.lead] : []);
      // The property's own plans are the one thing a new-build client always
      // asks to see, so they are ticked as the lead is: on its own pages only.
      const selectedPlans = new Set(source
        ? offer.plans.filter((plan) => previews.has(plan.key)).slice(0, REPORT_FLOOR_PLAN_LIMIT).map((plan) => plan.key)
        : []);
      setState({ status: 'ready', offer, previews, selected, selectedPlans, source, reading });
    });
  }, [revoke]);

  const setSelected = useCallback((next: Set<string>) => {
    setState((current) => (current ? { ...current, selected: next } : current));
  }, []);

  const setSelectedPlans = useCallback((next: Set<string>) => {
    setState((current) => (current ? { ...current, selectedPlans: next } : current));
  }, []);

  const filingArgs = useCallback(() => brochureFilingArgs(stateRef.current), []);

  return { state, begin, settle, reset, setSelected, setSelectedPlans, filingArgs };
}
