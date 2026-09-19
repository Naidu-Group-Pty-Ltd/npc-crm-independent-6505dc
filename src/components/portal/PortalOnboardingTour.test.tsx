import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * The Client Portal onboarding tour.
 *
 * ## The bug these exist for
 *
 * Every tour target lives in the desktop sidebar (`hidden md:flex`), but the
 * tour mounted its `fixed inset-0` overlay at every width. On a phone the
 * portal's glass theme renders that overlay as near-transparent, so a client
 * who had not completed onboarding saw a perfectly normal dashboard that
 * swallowed every tap and would not scroll — a full-screen touch trap with
 * nothing visibly wrong. These tests pin the containment: below `md` the tour
 * must render NOTHING, and leaving `md` mid-tour must tear it down without
 * leaving inline styles on its targets.
 */

const completeOnboarding = vi.fn();
let mockUser: { has_completed_onboarding: boolean } | null = null;

vi.mock('@/hooks/usePortalAuth', () => ({
  usePortalAuth: () => ({ user: mockUser, completeOnboarding }),
}));

import { PortalOnboardingTour } from './PortalOnboardingTour';

type MediaListener = (e: { matches: boolean }) => void;

/** A controllable window.matchMedia whose `change` events actually fire. */
function installMatchMedia(initialMatches: boolean, seenQueries: string[] = []) {
  const listeners = new Set<MediaListener>();
  let matches = initialMatches;
  window.matchMedia = ((query: string) => {
    seenQueries.push(query);
    return {
      get matches() { return matches; },
      media: query,
      onchange: null,
      addEventListener: (_type: string, cb: MediaListener) => { listeners.add(cb); },
      removeEventListener: (_type: string, cb: MediaListener) => { listeners.delete(cb); },
      addListener: (cb: MediaListener) => { listeners.add(cb); },
      removeListener: (cb: MediaListener) => { listeners.delete(cb); },
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
  return {
    setMatches(next: boolean) {
      matches = next;
      listeners.forEach((cb) => cb({ matches: next }));
    },
  };
}

/** Any mounted fixed full-screen layer — the shape of the original trap. */
function fullScreenFixedLayers(): Element[] {
  return [...document.querySelectorAll('div')].filter((el) =>
    el.className.includes('fixed') && el.className.includes('inset-0'));
}

describe('PortalOnboardingTour', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUser = { has_completed_onboarding: false };
    completeOnboarding.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.querySelectorAll('[data-tour]').forEach((el) => el.remove());
  });

  it('renders nothing below md — no overlay, no touch trap', () => {
    installMatchMedia(false);
    const { container } = render(<PortalOnboardingTour />);
    act(() => { vi.advanceTimersByTime(2000); });

    expect(container).toBeEmptyDOMElement();
    expect(fullScreenFixedLayers()).toHaveLength(0);
  });

  it('still offers the tour at md and above', () => {
    installMatchMedia(true);
    render(<PortalOnboardingTour />);
    act(() => { vi.advanceTimersByTime(2000); });

    expect(screen.getByText('Welcome to Your Portal')).toBeInTheDocument();
    expect(fullScreenFixedLayers().length).toBeGreaterThan(0);
  });

  it('gates on input capability, not width alone — the query demands hover and a fine pointer', () => {
    // A fold/tablet in desktop-site mode satisfies (min-width: 768px) while
    // its only input is a finger. The gate must therefore be a single media
    // query that ANDs width with hover + fine pointer, so a touch-only
    // device can never satisfy it regardless of reported width.
    const seen: string[] = [];
    installMatchMedia(false, seen);
    render(<PortalOnboardingTour />);
    const gate = seen.find((q) => q.includes('(min-width: 768px)'));
    expect(gate).toBeDefined();
    expect(gate).toContain('(hover: hover)');
    expect(gate).toContain('(pointer: fine)');
  });

  it('does not activate for a user who has completed onboarding', () => {
    installMatchMedia(true);
    mockUser = { has_completed_onboarding: true };
    const { container } = render(<PortalOnboardingTour />);
    act(() => { vi.advanceTimersByTime(2000); });

    expect(container).toBeEmptyDOMElement();
  });

  it('tears down mid-tour when the viewport drops below md, leaving no overlay and no inline styles', () => {
    const media = installMatchMedia(true);

    // A stand-in for the sidebar link the first step highlights.
    const target = document.createElement('div');
    target.setAttribute('data-tour', 'dashboard');
    document.body.appendChild(target);

    render(<PortalOnboardingTour />);
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.click(screen.getByText('Start Tour'));

    // The step is live: the target carries the highlight styles.
    expect(target.style.zIndex).toBe('60');
    expect(fullScreenFixedLayers().length).toBeGreaterThan(0);

    act(() => { media.setMatches(false); });

    expect(fullScreenFixedLayers()).toHaveLength(0);
    expect(target.getAttribute('style') ?? '').toBe('');
    // Shrinking the window is not finishing the tour.
    expect(completeOnboarding).not.toHaveBeenCalled();
  });
});
