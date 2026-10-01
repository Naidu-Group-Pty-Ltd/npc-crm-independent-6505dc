/**
 * What the CRM-independent line does not carry.
 *
 * This repository is the head of the CRM-independent line: a variant of the
 * prime whose CRM lives in its own Postgres, a closed system that does not
 * depend on GoHighLevel. The prime ships the GoHighLevel integration to every
 * clone on the dependent line; Aurixa Mission Control withholds it from this
 * line by CLASS, keyed on the clone's recorded `crm_mode`
 * (`src/server/crmLineFeatures.pure.ts` in aurixa-mission-control). The
 * cascade never writes these files here, the deploy lanes never deploy these
 * functions, and the fleet sweep unschedules the jobs that call them.
 *
 * Neither repository can read the other's source, so the list is a literal at
 * each end, like `primeOnlyFeatures.mjs`: a function added to one is added to
 * the other. The browser's copy is `WITHHELD_CRM_FUNCTIONS` in
 * `src/lib/crm/crmProvider.ts`, and `crmLineFeatures.spec.ts` holds the two to
 * each other and to this tree.
 *
 * What is deliberately NOT here: the schema (`ghl_conversations` and its
 * siblings are the native CRM's own storage), the mixed modules the line still
 * reads (`_shared/ghl-account.ts`, `_shared/ghlConversationMap.pure.ts`), and
 * the three `crm-*` functions, which ARE this line's CRM.
 *
 * What reads it:
 *   - `scripts/security/check-cron-caller-names.mjs`. The migrations that
 *     schedule the GoHighLevel jobs travel with the schema (a withheld
 *     migration is a ledger hole), while the functions they call do not.
 */

export const CRM_LINE_WITHHELD_FUNCTIONS = Object.freeze([
  'backfill-lead-attributions',
  'backfill-message-directions',
  'backfill-notes-to-ghl',
  'conversation-sync-cron',
  'diagnose-ghl-attribution',
  'ghl-calendar',
  'ghl-calendar-proxy',
  'ghl-calendar-test',
  'ghl-conversations-cron',
  'ghl-webhook-receiver',
  'import-clients-from-ghl',
  'one-time-bulk-conversation-sync',
  'send-ghl-message',
  'sync-client-to-ghl',
  'sync-ghl-conversations',
  'sync-ghl-marketing-assets',
  'sync-ghl-pipelines',
  'sync-notes-to-ghl',
  'update-ghl-opportunity-stage',
]);

export const CRM_LINE_WITHHELD_FILES = Object.freeze([
  'supabase/functions/_shared/ghlBootstrapWindow.pure.ts',
  'supabase/functions/_shared/ghlConversationPaging.ts',
  'supabase/functions/_shared/ghlConversationStore.ts',
  'supabase/functions/_shared/ghl-rate-limiter.ts',
  'src/lib/sync/__tests__/ghlBootstrapWindow.test.ts',
  'src/lib/sync/__tests__/ghlConversationPaging.test.ts',
  'src/pages/__tests__/crmConversations.spec.ts',
  'src/lib/security/bulkConversationSync.security.test.ts',
]);

const FUNCTIONS = new Set(CRM_LINE_WITHHELD_FUNCTIONS);

export function isCrmLineWithheldFunction(name) {
  return FUNCTIONS.has(name);
}
