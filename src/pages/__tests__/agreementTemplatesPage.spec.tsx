/**
 * The Agreement Templates page, driven the way it is actually reached.
 *
 * `/partner-agreements` has no sidebar entry, so every arrival is one of:
 * a click from inside the app, the ⌘K palette, one of four retired routes
 * redirecting here, or a bookmark. The last two leave no app history behind
 * them, and that is the case a Back button gets wrong by default — so it is
 * the case with the most assertions below.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AgreementTemplates from '@/pages/AgreementTemplates';

function Here() {
  const location = useLocation();
  return <div data-testid="here">{location.pathname}</div>;
}

function renderPage(initialEntries: string[] = ['/partner-agreements']) {
  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
      <Here />
      <Routes>
        <Route path="/partner-agreements" element={<AgreementTemplates />} />
        <Route path="/dashboard" element={<div>Overview</div>} />
        <Route path="/admin/finance-portal" element={<div>Finance Partners</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** What React Router's history writes when the user has navigated in-app. */
function withAppHistory(idx: number) {
  window.history.replaceState({ usr: null, key: 'test-key', idx }, '');
}

describe('the page', () => {
  beforeEach(() => {
    // jsdom starts with `history.state === null`, which is exactly the state
    // of a bookmarked or redirected arrival.
    window.history.replaceState(null, '');
  });

  afterEach(() => {
    window.history.replaceState(null, '');
  });

  it('no longer opens by explaining what the page used to be', () => {
    renderPage();
    expect(screen.queryByText(/has been retired/i)).toBeNull();
    expect(screen.queryByText(/templates are still here/i)).toBeNull();
  });

  it('still leads with its title and the templates', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Agreement Templates', level: 1 })).toBeTruthy();
    expect(screen.getByText('Strategic Property Referral Agreement')).toBeTruthy();
    expect(screen.getByText('Finance Referral & Commission Agreement')).toBeTruthy();
    // The neutrality notice is not the sentence that was removed, and stays.
    expect(screen.getByText(/not a party to it/i)).toBeTruthy();
  });
});

describe('getting back out', () => {
  beforeEach(() => window.history.replaceState(null, ''));
  afterEach(() => window.history.replaceState(null, ''));

  it('names where it is going when there is no app history to step into', () => {
    // A bookmark, an emailed link, a fresh tab, or one of the four retired
    // routes redirecting here. "Back" alone would be a promise it cannot keep.
    renderPage();
    expect(screen.getByRole('button', { name: /Back to Dashboard/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Back$/ })).toBeNull();
  });

  it('goes to the Overview from a bookmarked arrival', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Back to Dashboard/ }));
    await waitFor(() => expect(screen.getByTestId('here').textContent).toBe('/dashboard'));
  });

  it('says just "Back" when the user walked here', () => {
    withAppHistory(3);
    renderPage(['/admin/finance-portal', '/partner-agreements']);
    expect(screen.getByRole('button', { name: /^Back$/ })).toBeTruthy();
  });

  it('returns to where they came from, not to the fallback', async () => {
    // The Finance Partners admin page is the main in-app door in. Landing on
    // the Overview instead would lose their place for no reason.
    withAppHistory(1);
    renderPage(['/admin/finance-portal', '/partner-agreements']);
    fireEvent.click(screen.getByRole('button', { name: /^Back$/ }));
    await waitFor(() => expect(screen.getByTestId('here').textContent).toBe('/admin/finance-portal'));
  });

  it('sits above the title, where a way out is looked for', () => {
    renderPage();
    const back = screen.getByRole('button', { name: /Back to Dashboard/ });
    const heading = screen.getByRole('heading', { name: 'Agreement Templates', level: 1 });
    const backComesFirst = back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(Boolean(backComesFirst)).toBe(true);
  });
});
