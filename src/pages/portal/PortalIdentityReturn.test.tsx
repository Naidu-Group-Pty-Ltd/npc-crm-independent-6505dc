import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import PortalIdentityReturn from './PortalIdentityReturn';

/**
 * The page the customer lands on when the secure identity check finishes.
 *
 * The provider appends its own query parameters to this URL — a session
 * identifier and a status word among them. This page exists partly to be the
 * place where those are ignored: a redirect is authored by whatever the
 * browser was last pointed at, so a page that read `?status=Approved` and
 * acted on it would let anybody who can type a URL mark themselves verified.
 *
 * What it is allowed to say is that the information arrived. Everything about
 * whether it was ACCEPTED comes from the signed webhook and the authenticated
 * decision fetch behind it, neither of which this page can see.
 */
describe('the identity return page', () => {
  const renderAt = (search = '') => render(
    <MemoryRouter initialEntries={[`/client/aml/identity-return${search}`]}>
      <PortalIdentityReturn />
    </MemoryRouter>,
  );

  beforeEach(() => {
    Object.defineProperty(window, 'opener', {
      value: null, configurable: true, writable: true,
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('confirms receipt and claims nothing about the outcome', () => {
    renderAt();

    expect(screen.getByText(/verification received/i)).toBeTruthy();
    expect(screen.getByText(/securely received and is being reviewed/i)).toBeTruthy();
    // "Received" is what NPC knows here. "Verified" is a statement only the
    // server-side decision may make, and this page has not read it.
    expect(screen.queryByText(/identity verified|you are verified|approved/i)).toBeNull();
  });

  it('is unmoved by whatever the provider put in the query string', () => {
    /*
     * Every one of these is a value the provider may legitimately append, or
     * that somebody may forge. The page renders identically for all of them
     * because it reads none of them.
     */
    const plain = renderAt().container.textContent;
    cleanup();

    for (const search of [
      '?status=Approved',
      '?status=Declined&verificationSessionId=abc-123',
      '?status=Approved&verified=true&decision=pass',
    ]) {
      const { container } = renderAt(search);
      expect(container.textContent).toBe(plain);
      expect(container.textContent).not.toMatch(/approved|declined|abc-123/i);
      cleanup();
    }
  });

  it('tells its opener the customer came back, at this origin only', () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'opener', {
      value: { closed: false, postMessage }, configurable: true, writable: true,
    });

    renderAt('?status=Approved');

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [payload, targetOrigin] = postMessage.mock.calls[0];
    // A bare type. There is deliberately no field that could carry a verdict,
    // so there is nothing for a future edit to start trusting — and the target
    // origin means only an NPC page can receive it at all.
    expect(payload).toEqual({ type: 'npc:identity-return' });
    expect(targetOrigin).toBe(window.location.origin);
    // The status in the URL is not forwarded, even as context.
    expect(JSON.stringify(payload)).not.toMatch(/approved/i);
  });

  it('offers to close itself only when something opened it', () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'opener', {
      value: { closed: false, postMessage }, configurable: true, writable: true,
    });
    renderAt();

    expect(screen.getByRole('button', { name: /close this window/i })).toBeTruthy();
    cleanup();

    // A customer who got here by a full-page navigation — the ordinary case on
    // a phone that was handed the check — gets a way back instead of a button
    // that would silently do nothing.
    Object.defineProperty(window, 'opener', {
      value: null, configurable: true, writable: true,
    });
    renderAt();
    expect(screen.queryByRole('button', { name: /close this window/i })).toBeNull();
    expect(screen.getByRole('link', { name: /return to identity/i })
      .getAttribute('href')).toBe('/client/aml');
  });

  it('survives an opener that has already gone', () => {
    Object.defineProperty(window, 'opener', {
      value: { closed: true, postMessage: () => { throw new Error('closed'); } },
      configurable: true, writable: true,
    });

    expect(() => renderAt()).not.toThrow();
    expect(screen.getByText(/verification received/i)).toBeTruthy();
  });

  it('shows nothing that needs protecting', () => {
    // It sits outside the portal's authenticated tree, so a customer arriving
    // with no session is not bounced to a login screen at the end of their
    // verification. That is only safe because there is no case, no name, no
    // status and no identifier on the page.
    const { container } = renderAt('?verificationSessionId=sess-abc&status=Approved');
    expect(container.textContent).not.toMatch(/sess-abc|case|reference|score/i);
  });
});
