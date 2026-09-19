/**
 * When the wizard may replace what is in the form with the stored draft.
 *
 * Its own module because the rule is subtle enough to be worth testing, and a
 * rule tested through a copy of itself is not tested at all.
 *
 * The wizard reloads the stored draft whenever the server copy changes. That
 * is right on first paint and wrong mid-edit: every save invalidates the
 * detail query, so the refetch lands a moment after the step advances, and an
 * unguarded reload discarded whatever the user had already typed on the next
 * step — silently, with no error and nothing to undo.
 */

export interface DraftLoadState {
  /** `${id}:${updated_at}` of the copy already in the form, or null. */
  loaded: string | null;
  /** Whether the form holds edits that have not been saved yet. */
  dirty: boolean;
}

/** Should the incoming server copy replace what is in the form? */
export function shouldLoadDraft(stamp: string, state: DraftLoadState): boolean {
  // Already showing exactly this copy.
  if (state.loaded === stamp) return false;
  // First paint: there is nothing to protect yet.
  if (state.loaded === null) return true;
  // Otherwise the user's unsaved work outranks the server copy.
  return !state.dirty;
}
