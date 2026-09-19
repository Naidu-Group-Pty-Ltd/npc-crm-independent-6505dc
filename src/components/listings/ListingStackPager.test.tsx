import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ListingStackPager } from './ListingStackPager';

afterEach(cleanup);

/**
 * This control is the whole of what replaced `leaflet.markercluster`'s
 * spiderfy. Twenty-six listings share one Traralgon address; without a working
 * pager, twenty-five of them cannot be opened from the map at all.
 */
describe('ListingStackPager', () => {
  it('says where the reader is in the stack', () => {
    render(<ListingStackPager pager={{ index: 0, total: 26, onStep: vi.fn() }} />);
    // "1 of 26", not "0 of 26" — the count on the pin is one-based.
    expect(screen.getByRole('group').textContent).toContain('1');
    expect(screen.getByRole('group').textContent).toContain('26');
  });

  it('names the location every member shares', () => {
    render(
      <ListingStackPager
        pager={{ index: 3, total: 26, onStep: vi.fn() }}
        where="Traralgon"
      />,
    );
    expect(screen.getByText('Traralgon')).toBeTruthy();
  });

  it('steps forward and backward', () => {
    const onStep = vi.fn();
    render(<ListingStackPager pager={{ index: 3, total: 26, onStep }} />);

    fireEvent.click(screen.getByLabelText('Next property at this location'));
    expect(onStep).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByLabelText('Previous property at this location'));
    expect(onStep).toHaveBeenCalledWith(-1);
  });

  it('offers both arrows at each end — neither is ever a dead end', () => {
    // The caller wraps. A disabled arrow at the end of a list reads as a
    // broken control, and there is no ordering here a reader thinks of as
    // having a start.
    for (const index of [0, 25]) {
      cleanup();
      render(<ListingStackPager pager={{ index, total: 26, onStep: vi.fn() }} />);
      expect(
        screen.getByLabelText('Previous property at this location').hasAttribute('disabled'),
      ).toBe(false);
      expect(
        screen.getByLabelText('Next property at this location').hasAttribute('disabled'),
      ).toBe(false);
    }
  });

  it('draws nothing for a property standing on its own', () => {
    // A "1 of 1" with two arrows is a control that cannot be operated.
    const { container } = render(
      <ListingStackPager pager={{ index: 0, total: 1, onStep: vi.fn() }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('is announced as a group, so the arrows are not two loose buttons', () => {
    render(<ListingStackPager pager={{ index: 5, total: 26, onStep: vi.fn() }} />);
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe(
      'Property 6 of 26 at this location',
    );
  });
});
