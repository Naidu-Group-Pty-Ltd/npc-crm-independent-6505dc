/**
 * A bounded dialog must never be told not to clip.
 *
 * The default treatment sets `sm:max-h-[85dvh]` and used to set
 * `sm:overflow-visible` beside it — a bounded box instructed not to clip. Any
 * dialog whose content exceeded the bound painted straight through its own
 * bottom border with no scrollbar on either axis, so its footer buttons were
 * on screen and unreachable. The 19 Sep 2026 clone audit reported FIVE of them
 * as five unrelated defects; the Client Tracker export is the one checked by
 * name below, because it states a width and nothing else and is therefore
 * entirely at the mercy of this default.
 *
 * Rendered rather than reasoned about: the composition is a `cn()` of
 * conditionals over a caller's own className, which is exactly the kind of
 * thing that reads correct and merges wrong.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from '../dialog';

function classesFor(className?: string): string {
  render(
    <Dialog open>
      <DialogContent className={className}>
        <DialogTitle>Export</DialogTitle>
      </DialogContent>
    </Dialog>,
  );
  return screen.getByRole('dialog').className;
}

describe('the default dialog treatment', () => {
  it('bounds the height and gives it somewhere to scroll', () => {
    const classes = classesFor();
    expect(classes).toContain('sm:max-h-[85dvh]');
    expect(classes).toContain('sm:overflow-y-auto');
    expect(classes).not.toContain('sm:overflow-visible');
  });

  it('agrees with the mobile sheet instead of contradicting it', () => {
    // The bottom sheet has always been `max-h-[92dvh] overflow-y-auto`; the
    // desktop half used to disagree with it at exactly 640px.
    const classes = classesFor();
    expect(classes).toContain('max-h-[92dvh]');
    expect(classes).toContain('overflow-y-auto');
  });

  it('reaches a dialog that states only a width — the Client Tracker export', () => {
    // `GHLExportDialog` renders `<DialogContent className="max-w-3xl">` with
    // eight mapping cards, a checkbox block, a preview strip and a three-button
    // footer, and declares no height and no overflow of its own.
    const classes = classesFor('max-w-3xl');
    expect(classes).toContain('max-w-3xl');
    expect(classes).toContain('sm:max-h-[85dvh]');
    expect(classes).toContain('sm:overflow-y-auto');
    // The width it asked for is honoured, so the default width is withheld.
    expect(classes).not.toContain('sm:max-w-lg');
  });

  it('still lets a caller own the overflow, inner-scroller shapes included', () => {
    // Those call sites pair `overflow-hidden` with a bounded inner scroller,
    // which only works if the shell clips.
    const classes = classesFor('flex max-h-[90vh] flex-col overflow-hidden');
    expect(classes).toContain('overflow-hidden');
    expect(classes).not.toContain('sm:overflow-y-auto');
    expect(classes).not.toContain('sm:max-h-[85dvh]');
  });

  it('never bounds a height without a way to reach what is past it', () => {
    // The rule, over every combination of what a caller may state.
    for (const className of [
      undefined,
      'max-w-3xl',
      'sm:max-w-5xl',
      'max-h-[90vh]',
      'w-[95vw] max-w-3xl',
    ]) {
      const classes = classesFor(className);
      const bounded = /max-h-/.test(classes);
      const scrolls = /overflow-(?:y-)?(?:auto|scroll|hidden|clip)/.test(classes);
      expect(bounded && !scrolls, `bounded with no scroll: ${className}`).toBe(false);
    }
  });
});
