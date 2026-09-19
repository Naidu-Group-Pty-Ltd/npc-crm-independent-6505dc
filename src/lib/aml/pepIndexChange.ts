/**
 * Browser entry point for index-change detection — see
 * `supabase/functions/_shared/aml/pepIndexChange.pure.ts`.
 *
 * The readings, the origin of a new candidate and the words that go in the
 * alert are decided once, there. The sweep in `aml-monitoring` runs it and
 * writes an alert; nothing in it can write a determination.
 */
export {
  PEP_INDEX_CHANGE_ALERT_TITLE,
  changeSeverity,
  detectIndexChange,
  type IndexMatch,
  type NewCandidate,
  type PepIndexChange,
  type PepIndexChangeReading,
  type PriorScreening,
  type SourceFirstLoaded,
} from '../../../supabase/functions/_shared/aml/pepIndexChange.pure.ts';
