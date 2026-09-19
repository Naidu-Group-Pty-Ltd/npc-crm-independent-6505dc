/**
 * Scroll to and flash a field that an error summary points at.
 *
 * Navigating to the right step is only half the job: on a long step the user
 * still has to hunt for which of forty fields is wrong. This brings the field
 * into view, rings it, and moves focus into its control so the fix can be typed
 * straight away.
 *
 * The DOM hook is `data-ci-field="<payload path>"`, written by `FieldShell`.
 * Paths are the same strings validation reports, so there is one vocabulary
 * across the validator, the summary and the markup.
 */

/** How long the ring stays before fading. Long enough to notice, short enough not to nag. */
const FLASH_MS = 2400;

/** Retry window for a field that is still mounting after a step change. */
const MAX_ATTEMPTS = 12;
const RETRY_MS = 60;

const HIGHLIGHT_CLASS = 'ci-field-flash';

let activeTimer: ReturnType<typeof setTimeout> | null = null;

/** CSS.escape is not in jsdom and not in older Safari; the paths are tame anyway. */
function escapeAttr(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function clearExisting(): void {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`)
    .forEach((node) => node.classList.remove(HIGHLIGHT_CLASS));
}

/**
 * Move focus to the field's own control without scrolling a second time.
 *
 * Focusing matters for keyboard and screen-reader users: the summary is the
 * navigation, so landing focus in the control is what makes it usable without a
 * mouse. `preventScroll` stops the browser fighting our smooth scroll.
 */
function focusControl(container: Element): void {
  const control = container.querySelector<HTMLElement>(
    'input:not([type="hidden"]), textarea, select, button[role="combobox"], [tabindex]:not([tabindex="-1"])',
  );
  if (!control) return;
  try {
    control.focus({ preventScroll: true });
  } catch {
    control.focus();
  }
}

/**
 * Find `data-ci-field="path"` and highlight it.
 *
 * Returns false when the field is not on the page — a section-level issue, or a
 * collection row that has since been deleted — so the caller can decide whether
 * that is worth telling the user about.
 */
export function focusAssessmentField(path: string): boolean {
  if (typeof document === 'undefined' || !path) return false;

  const target = document.querySelector<HTMLElement>(`[data-ci-field="${escapeAttr(path)}"]`);
  if (!target) return false;

  clearExisting();
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add(HIGHLIGHT_CLASS);
  focusControl(target);

  activeTimer = setTimeout(() => {
    target.classList.remove(HIGHLIGHT_CLASS);
    activeTimer = null;
  }, FLASH_MS);

  return true;
}

/**
 * Highlight a field that may not have rendered yet.
 *
 * Clicking an issue for another step changes the step first, so the target does
 * not exist on the current frame. Rather than guess a delay, poll briefly and
 * stop as soon as it appears — a step that renders instantly flashes instantly,
 * and one that never renders gives up quietly instead of hanging.
 */
export function focusAssessmentFieldWhenReady(path: string): void {
  if (typeof window === 'undefined' || !path) return;

  let attempts = 0;
  const attempt = () => {
    if (focusAssessmentField(path)) return;
    attempts += 1;
    if (attempts < MAX_ATTEMPTS) window.setTimeout(attempt, RETRY_MS);
  };
  // requestAnimationFrame so the first try lands after React has committed.
  window.requestAnimationFrame(attempt);
}
