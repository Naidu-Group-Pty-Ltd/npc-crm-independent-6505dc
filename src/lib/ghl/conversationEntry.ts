/**
 * Browser entry point for "may this GoHighLevel entry be drawn as a message?"
 *
 * The classifier lives in `supabase/functions/_shared/ghlConversationMap.pure.ts`
 * beside the mappers that write these rows, because the Edge runtime cannot
 * import from `src/` and the sync and the thread must not disagree about what
 * counts as correspondence.
 *
 * Re-exporting is what stops a fourth copy: `normalizeChannel` is already
 * written twice in this repository — once in `pages/Conversations.tsx` and once
 * in `components/clients/ClientConversationsTab.tsx` — and the two have
 * measurably drifted (the second knows neither `mail` nor `whats_app`, so a row
 * carrying either draws with no channel icon there and with one here). There is
 * nothing in this file to drift.
 */

export {
  classifyGhlEntry,
  isCorrespondence,
  summariseWithheldEntries,
  withheldEntriesSentence,
  GHL_ACTIVITY_PREFIX,
  GHL_NON_MESSAGE_CHANNELS,
} from '../../../supabase/functions/_shared/ghlConversationMap.pure.ts';
export type { GhlEntryKind, WithheldSummary } from '../../../supabase/functions/_shared/ghlConversationMap.pure.ts';
