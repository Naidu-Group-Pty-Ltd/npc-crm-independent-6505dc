import { describe, expect, it } from 'vitest';
import {
  getManualOverrideShellVariables,
  MANUAL_OVERRIDE_CONTENT_CLASSNAME,
  MANUAL_OVERRIDE_MAX_WIDTH_PX,
  MANUAL_OVERRIDE_OVERLAY_CLASSNAME,
} from '../manualOverrideLayout';

describe('Manual Data Override shell positioning', () => {
  it('offsets the portal from the expanded dashboard sidebar', () => {
    expect(getManualOverrideShellVariables('expanded', true)).toMatchObject({
      '--manual-override-sidebar-width': '16rem',
      '--manual-override-header-height': '72px',
    });
  });

  it('uses the collapsed sidebar width without retaining the expanded offset', () => {
    expect(getManualOverrideShellVariables('collapsed', true)).toMatchObject({
      '--manual-override-sidebar-width': '3rem',
      '--manual-override-header-height': '72px',
    });
  });

  it('removes the desktop sidebar offset when the dashboard uses mobile/tablet chrome', () => {
    expect(getManualOverrideShellVariables('expanded', false)).toMatchObject({
      '--manual-override-sidebar-width': '0px',
      '--manual-override-header-height': '56px',
    });
  });

  it('drives the sidebar offset purely from state so the modal tracks collapse/expand', () => {
    const expanded = getManualOverrideShellVariables('expanded', true);
    const collapsed = getManualOverrideShellVariables('collapsed', true);
    expect(expanded['--manual-override-sidebar-width' as keyof typeof expanded]).not.toEqual(
      collapsed['--manual-override-sidebar-width' as keyof typeof collapsed],
    );
  });
});

describe('Manual Data Override overlay contract', () => {
  it('starts the backdrop after the sidebar and below the header, keeping chrome visible', () => {
    expect(MANUAL_OVERRIDE_OVERLAY_CLASSNAME).toContain('!left-[var(--manual-override-sidebar-width)]');
    expect(MANUAL_OVERRIDE_OVERLAY_CLASSNAME).toContain('!top-[var(--manual-override-header-height)]');
    expect(MANUAL_OVERRIDE_OVERLAY_CLASSNAME).toContain('!right-0');
    expect(MANUAL_OVERRIDE_OVERLAY_CLASSNAME).toContain('!bottom-0');
  });

  it('never pins the backdrop to the viewport edges (would cover the sidebar)', () => {
    expect(MANUAL_OVERRIDE_OVERLAY_CLASSNAME).not.toContain('inset-0');
    expect(MANUAL_OVERRIDE_OVERLAY_CLASSNAME).not.toContain('left-0');
  });
});

describe('Manual Data Override content contract', () => {
  it('begins one gutter after the current sidebar width', () => {
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).toContain(
      'left-[calc(var(--manual-override-sidebar-width)_+_1rem)]',
    );
  });

  it('sits one gutter below the persistent top header', () => {
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).toContain(
      'top-[calc(var(--manual-override-header-height)_+_1rem)]',
    );
  });

  it('is centred within the available content frame with a right gutter', () => {
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).toContain('mx-auto');
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).toContain('right-4');
  });

  it('caps its width below full width and stays in sync with the exported max', () => {
    expect(MANUAL_OVERRIDE_MAX_WIDTH_PX).toBeLessThan(1920);
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).toContain(`max-w-[${MANUAL_OVERRIDE_MAX_WIDTH_PX}px]`);
  });

  it('never stretches edge-to-edge across the viewport', () => {
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).not.toContain('w-screen');
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).not.toContain('100vw');
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).not.toContain('w-full');
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).not.toContain('max-w-none');
  });

  it('pins both vertical insets so the height is definite (required for internal scroll)', () => {
    // A Radix ScrollArea body scrolls via a height:100% chain, which only resolves
    // against a definite ancestor height. Pinning top AND bottom makes the fixed
    // dialog height definite; max-height alone (indefinite) would collapse the chain.
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).toContain(
      'top-[calc(var(--manual-override-header-height)_+_1rem)]',
    );
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).toContain('bottom-4');
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).not.toContain('h-auto');
  });

  it('keeps a responsive maximum height as a safety cap', () => {
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).toContain(
      'max-h-[calc(100dvh_-_var(--manual-override-header-height)_-_2rem)]',
    );
  });

  it('is a three-region flex shell that clips overflow to the modal frame', () => {
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).toContain('flex');
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).toContain('flex-col');
    expect(MANUAL_OVERRIDE_CONTENT_CLASSNAME).toContain('overflow-hidden');
  });
});
