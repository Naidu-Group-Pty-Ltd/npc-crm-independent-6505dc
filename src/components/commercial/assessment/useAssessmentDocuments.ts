/**
 * The documents one assessment has issued, from both report ledgers.
 *
 * Keyed by assessment: an answer that arrives after the page has moved to a
 * different assessment is dropped, so one assessment's documents never appear
 * under another's name for the length of a request.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ciAssessmentApi } from '@/hooks/useCiAssessments';
import type { IssuedDocument } from '@/lib/ciAssessment/issuedDocuments';

export interface AssessmentDocuments {
  documents: IssuedDocument[];
  /** True until the first answer for this assessment arrives. */
  loading: boolean;
  error: string | null;
  reload: () => void;
}

interface Loaded {
  forId: string;
  documents: IssuedDocument[];
  error: string | null;
}

export function useAssessmentDocuments(assessmentId: string | null | undefined): AssessmentDocuments {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [generation, setGeneration] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (!assessmentId) return;
    const ask = ++latest.current;
    void ciAssessmentApi.listDocuments(assessmentId).then(
      ({ data, error }) => {
        if (ask !== latest.current) return;
        setLoaded({ forId: assessmentId, documents: data ?? [], error });
      },
      (error: unknown) => {
        if (ask !== latest.current) return;
        setLoaded({
          forId: assessmentId,
          documents: [],
          error: error instanceof Error ? error.message : 'The documents could not be read.',
        });
      },
    );
  }, [assessmentId, generation]);

  const reload = useCallback(() => setGeneration((value) => value + 1), []);

  const current = loaded && loaded.forId === assessmentId ? loaded : null;
  return {
    documents: current?.documents ?? [],
    loading: Boolean(assessmentId) && !current,
    error: current?.error ?? null,
    reload,
  };
}
