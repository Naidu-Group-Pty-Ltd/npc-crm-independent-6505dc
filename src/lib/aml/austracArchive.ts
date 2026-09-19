/**
 * Browser entry point for the archiving rules — see
 * `supabase/functions/_shared/aml/austracArchive.pure.ts`.
 *
 * The register renders from the same rule the edge function enforces, so what
 * an operator is offered and what the server accepts cannot become two
 * standards.
 */
export {
  ARCHIVABLE_STATUSES,
  archiveBlockReason,
  archiveWarning,
  isArchived,
} from '../../../supabase/functions/_shared/aml/austracArchive.pure.ts';
