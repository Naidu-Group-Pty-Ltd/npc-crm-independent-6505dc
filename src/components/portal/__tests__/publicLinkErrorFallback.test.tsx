/**
 * The public link pages degrade to an action, not to "Something went wrong".
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { PublicLinkErrorFallback } from '@/components/portal/PublicLinkErrorFallback';

function Throws(): JSX.Element {
  throw new Error('beforeAccept is not defined');
}

describe('PublicLinkErrorFallback', () => {
  beforeEach(() => {
    // The boundary logs deliberately; the noise is not the assertion.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces a thrown link page with the re-send instruction', () => {
    render(
      <ErrorBoundary fallback={<PublicLinkErrorFallback />}>
        <Throws />
      </ErrorBoundary>,
    );

    expect(screen.getByText('This page could not be displayed')).toBeInTheDocument();
    expect(screen.getByText(/ask the organisation that sent you this link/i)).toBeInTheDocument();
    // The recipient is told nothing was lost — they have no other way to know.
    expect(screen.getByText(/nothing has been recorded and nothing has been lost/i)).toBeInTheDocument();
  });

  it('renders without touching brand, router or data — a fallback must not throw', () => {
    render(<PublicLinkErrorFallback />);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
