import { describe, expect, it } from 'vitest';
import { declaresOwnMaxHeight, declaresOwnOverflow, declaresOwnWidth } from './dialog';

/**
 * The rule these pin: a width the caller states must win over the default.
 * 135 call sites were rendering at 512px because it did not.
 */
describe('declaresOwnWidth', () => {
  it('sees an unprefixed width, wherever it sits in the class list', () => {
    expect(declaresOwnWidth('max-w-5xl')).toBe(true);
    expect(declaresOwnWidth('flex flex-col max-w-2xl overflow-hidden')).toBe(true);
    expect(declaresOwnWidth('h-[92dvh] w-[calc(100vw-1rem)] max-w-3xl p-4')).toBe(true);
  });

  it('counts max-w-none — a full-bleed dialog is stating a width too', () => {
    expect(declaresOwnWidth('max-w-none')).toBe(true);
  });

  it('does not see a breakpoint-only width, so the default still covers below it', () => {
    // The one shape that already worked: it opts into the default deliberately.
    expect(declaresOwnWidth('lg:max-w-4xl xl:max-w-5xl')).toBe(false);
    expect(declaresOwnWidth('sm:max-w-lg')).toBe(false);
  });

  it('is not fooled by a class that merely ends in something similar', () => {
    expect(declaresOwnWidth('group-hover:max-w-xl')).toBe(false);
    expect(declaresOwnWidth('data-[state=open]:max-w-xl')).toBe(false);
  });

  it('treats no className as no stated width', () => {
    expect(declaresOwnWidth(undefined)).toBe(false);
    expect(declaresOwnWidth('')).toBe(false);
    expect(declaresOwnWidth('flex flex-col gap-4')).toBe(false);
  });
});

/**
 * The same rule on height. 110 call sites bounded themselves at a height the
 * default then took away from 640px up.
 */
describe('declaresOwnMaxHeight', () => {
  it('sees an unprefixed max-height, wherever it sits', () => {
    expect(declaresOwnMaxHeight('max-h-[90vh]')).toBe(true);
    expect(declaresOwnMaxHeight('w-[92vw] max-w-[680px] max-h-[90vh] p-4')).toBe(true);
    expect(declaresOwnMaxHeight('flex max-h-[calc(100dvh-2rem)] flex-col')).toBe(true);
  });

  it('does not see a breakpoint-only max-height', () => {
    // `sm:max-h-[85vh]` conflicts with the default on the same modifier, so
    // the merge already resolves it — withholding as well would be a second
    // mechanism doing one job.
    expect(declaresOwnMaxHeight('sm:max-h-[85vh]')).toBe(false);
    expect(declaresOwnMaxHeight('lg:max-h-[70vh]')).toBe(false);
  });

  it('is not fooled by a height that is not a maximum', () => {
    expect(declaresOwnMaxHeight('h-[90vh] flex flex-col')).toBe(false);
    expect(declaresOwnMaxHeight('min-h-[20rem]')).toBe(false);
  });

  it('treats no className as no stated height', () => {
    expect(declaresOwnMaxHeight(undefined)).toBe(false);
    expect(declaresOwnMaxHeight('')).toBe(false);
  });
});

/**
 * The instance the audit could see: a dialog that asked to scroll, did not,
 * and painted its footer out through its own bottom border.
 */
describe('declaresOwnOverflow', () => {
  it('sees a stated overflow on either axis', () => {
    expect(declaresOwnOverflow('overflow-y-auto')).toBe(true);
    expect(declaresOwnOverflow('overflow-x-hidden overflow-y-auto')).toBe(true);
    expect(declaresOwnOverflow('flex flex-col gap-0 overflow-hidden p-0')).toBe(true);
    expect(declaresOwnOverflow('overflow-auto')).toBe(true);
    expect(declaresOwnOverflow('overflow-scroll')).toBe(true);
  });

  it('counts overflow-visible — asking for no clipping is stating one', () => {
    expect(declaresOwnOverflow('overflow-visible')).toBe(true);
  });

  it('does not see a breakpoint-only overflow', () => {
    expect(declaresOwnOverflow('sm:overflow-hidden')).toBe(false);
    expect(declaresOwnOverflow('md:overflow-y-auto lg:overflow-visible')).toBe(false);
  });

  it('is not fooled by a class that merely contains the word', () => {
    expect(declaresOwnOverflow('group-hover:overflow-auto')).toBe(false);
    expect(declaresOwnOverflow('overflow-ellipsis')).toBe(false);
    expect(declaresOwnOverflow('text-overflow-clip')).toBe(false);
  });

  it('treats no className as no stated overflow', () => {
    expect(declaresOwnOverflow(undefined)).toBe(false);
    expect(declaresOwnOverflow('')).toBe(false);
    expect(declaresOwnOverflow('max-w-3xl p-6')).toBe(false);
  });
});

/**
 * The three rules are independent.
 *
 * A dialog that states a width and nothing else must keep the default height
 * and the default overflow — withholding all three together would silently
 * change 135 call sites that only ever asked about width.
 */
describe('the three rules do not bleed into each other', () => {
  const widthOnly = 'max-w-4xl';
  it('a stated width leaves the height and overflow defaults alone', () => {
    expect(declaresOwnWidth(widthOnly)).toBe(true);
    expect(declaresOwnMaxHeight(widthOnly)).toBe(false);
    expect(declaresOwnOverflow(widthOnly)).toBe(false);
  });

  it('a stated overflow leaves the width and height defaults alone', () => {
    expect(declaresOwnWidth('overflow-hidden')).toBe(false);
    expect(declaresOwnMaxHeight('overflow-hidden')).toBe(false);
    expect(declaresOwnOverflow('overflow-hidden')).toBe(true);
  });
});
