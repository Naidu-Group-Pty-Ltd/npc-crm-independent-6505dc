/**
 * Generated Reports' Commercial & Industrial documents — the caller's own.
 *
 * Read at the page, not in the tab, so the tab's count is a number before the
 * tab is opened: the Radix tab panel is unmounted while it is not shown. Not
 * read at all without the module, whose function would refuse the call.
 *
 * "Loading" is derived rather than set: it is true while the answer held is
 * not the answer to the latest ask, and the last library stays on screen while
 * a refresh is in flight.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ciAssessmentApi, type DocumentsLibrary } from '@/hooks/useCiAssessments';

export interface CommercialDocumentsLibrary {
  library: DocumentsLibrary | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

interface Answer {
  generation: number;
  library: DocumentsLibrary | null;
  error: string | null;
}

export function useCommercialDocumentsLibrary(enabled: boolean): CommercialDocumentsLibrary {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [generation, setGeneration] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const ask = ++latest.current;
    void ciAssessmentApi.documentsLibrary().then(
      ({ data, error }) => {
        if (ask !== latest.current) return;
        setAnswer({ generation, library: data ?? { documents: [], clients: [] }, error });
      },
      (failure: unknown) => {
        if (ask !== latest.current) return;
        setAnswer((previous) => ({
          generation,
          library: previous?.library ?? null,
          error: failure instanceof Error ? failure.message : 'The Commercial & Industrial reports could not be read.',
        }));
      },
    );
  }, [enabled, generation]);

  const reload = useCallback(() => setGeneration((value) => value + 1), []);

  return {
    library: enabled ? answer?.library ?? null : null,
    loading: enabled && answer?.generation !== generation,
    error: enabled ? answer?.error ?? null : null,
    reload,
  };
}
