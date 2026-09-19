import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The Client Portal's Documents step.
 *
 * ## The bug these exist for
 *
 * This screen rendered document REQUIREMENTS and never read the documents. A
 * customer uploaded a file, the server stored it, a toast said "Uploaded", and
 * then nothing: no filename, no row, and the same nothing after a reload. On a
 * case with no requirements — the common one — the screen still said "No
 * document requirements have been set yet" underneath the file they had just
 * sent. Uploads outside a requirement had nowhere on the page to appear at all.
 *
 * So the assertions below are mostly about VISIBILITY: that the list is read,
 * that a filename reaches the page, that it is still there after a re-read,
 * and that no state ever tells a customer nothing was received when something
 * was.
 */

const listDocuments = vi.fn();
const documentUrl = vi.fn();
const uploadAmlDocument = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/lib/aml/amlPortalApi', () => ({
  amlPortalApi: {
    listDocuments: (...a: unknown[]) => listDocuments(...a),
    documentUrl: (...a: unknown[]) => documentUrl(...a),
  },
  uploadAmlDocument: (...a: unknown[]) => uploadAmlDocument(...a),
}));
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));

import { DocumentsStep } from './DocumentsStep';

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'doc-1',
  requirement_id: null,
  filename: 'passport.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1_887_437,
  status: 'uploaded',
  uploaded_at: new Date().toISOString(),
  rejection_reason: null,
  ...over,
});

const requirement = (over: Record<string, unknown> = {}) => ({
  id: 'req-1', code: 'proof_of_identity', label: 'Proof of identity',
  description: 'A current photographic identity document',
  required: true, status: 'pending', ...over,
});

const onChange = vi.fn();
const noop = () => {};

/**
 * A stand-in for the tab View opens.
 *
 * jsdom's `window.open` returns null and warns, which is indistinguishable
 * from the blocked case — so the spy is always installed and the tests that
 * are ABOUT blocking opt into null explicitly.
 */
const fakeWindow = () => ({
  closed: false,
  opener: {} as unknown,
  location: { replace: vi.fn() },
  close: vi.fn(),
});
let viewer: ReturnType<typeof fakeWindow>;
let openSpy: ReturnType<typeof vi.spyOn>;
const renderStep = (requirements: any[] = []) => render(
  <DocumentsStep
    caseId="case-1"
    requirements={requirements}
    onChange={onChange}
    onNext={noop}
    onBack={noop}
  />,
);

/** A File the upload helper will be handed. */
const file = (name = 'drivers-licence.pdf') =>
  new File(['x'], name, { type: 'application/pdf' });

/** Drop a file on the input behind a labelled button. */
function chooseFile(button: HTMLElement, f: File) {
  const input = button.parentElement?.querySelector('input[type=file]')
    ?? button.closest('li')?.querySelector('input[type=file]')
    ?? document.querySelector('input[type=file]');
  fireEvent.change(input as HTMLInputElement, { target: { files: [f] } });
}

beforeEach(() => {
  listDocuments.mockReset();
  documentUrl.mockReset();
  uploadAmlDocument.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  onChange.mockReset();
  listDocuments.mockResolvedValue({ documents: [] });
  uploadAmlDocument.mockResolvedValue({ document: {} });
  viewer = fakeWindow();
  openSpy = vi.spyOn(window, 'open').mockReturnValue(viewer as unknown as Window);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/* ── loading the canonical list ──────────────────────────────────────────── */

describe('loading documents', () => {
  it('reads the canonical list when the step mounts', async () => {
    renderStep();
    // The whole root cause in one assertion: the old screen never asked.
    await waitFor(() => expect(listDocuments).toHaveBeenCalledWith('case-1'));
  });

  it('reads it once per case, not once per render', async () => {
    const { rerender } = renderStep();
    await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(1));
    rerender(
      <DocumentsStep caseId="case-1" requirements={[]} onChange={onChange} onNext={noop} onBack={noop} />,
    );
    await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(1));
  });

  it('shows an uploaded document with its name, type, size and date', async () => {
    listDocuments.mockResolvedValue({ documents: [doc({ filename: 'drivers-licence.pdf' })] });
    renderStep();

    expect(await screen.findByText('drivers-licence.pdf')).toBeTruthy();
    expect(screen.getByText(/PDF · 1\.8 MB · Uploaded/)).toBeTruthy();
    // Status is words, not only the tick's colour.
    expect(screen.getByText('Received')).toBeTruthy();
  });

  it('shows freeform documents, which previously had nowhere to appear', async () => {
    listDocuments.mockResolvedValue({
      documents: [
        doc({ id: 'a', requirement_id: null, filename: 'passport.pdf' }),
        doc({ id: 'b', requirement_id: null, filename: 'bank-statement.pdf' }),
      ],
    });
    renderStep();

    expect(await screen.findByText('passport.pdf')).toBeTruthy();
    expect(screen.getByText('bank-statement.pdf')).toBeTruthy();
    expect(screen.getByText(/uploaded documents/i)).toBeTruthy();
  });

  it('puts a requirement-linked document under its requirement, matched on id', async () => {
    listDocuments.mockResolvedValue({
      documents: [doc({ id: 'a', requirement_id: 'req-1', filename: 'licence.pdf' })],
    });
    renderStep([requirement({ status: 'uploaded' })]);

    const row = (await screen.findByText('Proof of identity')).closest('li')!;
    // Linkage is `requirement_id`, never a filename guess.
    expect(row.textContent).toContain('licence.pdf');
    expect(screen.queryByText(/additional documents/i)).toBeNull();
  });

  it('separates linked and freeform documents on the same case', async () => {
    listDocuments.mockResolvedValue({
      documents: [
        doc({ id: 'a', requirement_id: 'req-1', filename: 'licence.pdf' }),
        doc({ id: 'b', requirement_id: null, filename: 'bank-statement.pdf' }),
      ],
    });
    renderStep([requirement({ status: 'uploaded' })]);

    const row = (await screen.findByText('Proof of identity')).closest('li')!;
    expect(row.textContent).toContain('licence.pdf');
    expect(row.textContent).not.toContain('bank-statement.pdf');
    expect(screen.getByText(/additional documents/i)).toBeTruthy();
    expect(screen.getByText('bank-statement.pdf')).toBeTruthy();
  });

  it('shows the newest document for a replaced requirement, and only that one', async () => {
    // Replacing inserts a row rather than rewriting one, so a requirement can
    // legitimately hold several. The server orders newest first.
    listDocuments.mockResolvedValue({
      documents: [
        doc({ id: 'new', requirement_id: 'req-1', filename: 'licence-v2.pdf' }),
        doc({ id: 'old', requirement_id: 'req-1', filename: 'licence-v1.pdf' }),
      ],
    });
    renderStep([requirement({ status: 'uploaded' })]);

    expect(await screen.findByText('licence-v2.pdf')).toBeTruthy();
    // No invented history model.
    expect(screen.queryByText('licence-v1.pdf')).toBeNull();
  });

  it('says "Document received" rather than inventing a filename', async () => {
    // The requirement says something arrived but we hold no row for it — a
    // staff upload, or a list that failed. Claiming a name would be a guess.
    listDocuments.mockResolvedValue({ documents: [] });
    renderStep([requirement({ status: 'accepted' })]);

    expect(await screen.findByText('Document received')).toBeTruthy();
  });
});

/* ── uploading ───────────────────────────────────────────────────────────── */

describe('uploading', () => {
  it('makes the filename visible immediately, with no reload', async () => {
    listDocuments.mockResolvedValueOnce({ documents: [] });
    renderStep();
    await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(1));

    listDocuments.mockResolvedValue({
      documents: [doc({ filename: 'drivers-licence.pdf' })],
    });
    const button = screen.getByRole('button', { name: /upload additional document/i });
    chooseFile(button, file());

    // The persistent row is the confirmation; the toast is secondary.
    expect(await screen.findByText('drivers-licence.pdf')).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('refreshes the requirement state as well as the document list', async () => {
    renderStep([requirement()]);
    await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(1));

    chooseFile(screen.getByRole('button', { name: /upload proof of identity/i }), file());

    // Both, and independently: `confirm_upload` moves the requirement to
    // `uploaded`, which lives in the overview rather than the document list.
    await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('sends a freeform upload with no requirement id', async () => {
    renderStep([requirement()]);
    await waitFor(() => expect(listDocuments).toHaveBeenCalled());

    chooseFile(screen.getByRole('button', { name: /upload additional document/i }), file('extra.pdf'));

    await waitFor(() => expect(uploadAmlDocument).toHaveBeenCalledWith(
      'case-1', expect.any(File), null));
  });

  it('sends a requirement upload with that requirement id', async () => {
    renderStep([requirement()]);
    await waitFor(() => expect(listDocuments).toHaveBeenCalled());

    chooseFile(screen.getByRole('button', { name: /upload proof of identity/i }), file());

    await waitFor(() => expect(uploadAmlDocument).toHaveBeenCalledWith(
      'case-1', expect.any(File), 'req-1'));
  });

  it('reports a genuine upload failure and creates no success row', async () => {
    uploadAmlDocument.mockRejectedValue(new Error('File exceeds 25 MB limit'));
    renderStep();
    await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(1));

    chooseFile(screen.getByRole('button', { name: /upload additional document/i }), file('huge.pdf'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('File exceeds 25 MB limit'));
    expect(screen.queryByText('huge.pdf')).toBeNull();
    // Nothing was stored, so nothing is re-read.
    expect(listDocuments).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('never says the upload failed when only the refresh did', async () => {
    /*
     * The document EXISTS at this point. Reporting a failure would have the
     * customer send their identity document a second time, and we would hold
     * two copies of it because a list request timed out.
     */
    listDocuments.mockResolvedValueOnce({ documents: [] });
    renderStep();
    await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(1));

    listDocuments.mockRejectedValue(new Error('network'));
    chooseFile(screen.getByRole('button', { name: /upload additional document/i }), file());

    expect(await screen.findByText(/your document was uploaded/i)).toBeTruthy();
    expect(screen.getByText(/no need to upload it again/i)).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('disables every upload control while one is in flight', async () => {
    let release: (v: unknown) => void = () => {};
    uploadAmlDocument.mockReturnValue(new Promise((r) => { release = r; }));
    renderStep([requirement()]);
    await waitFor(() => expect(listDocuments).toHaveBeenCalled());

    chooseFile(screen.getByRole('button', { name: /upload proof of identity/i }), file());

    await waitFor(() => expect(
      screen.getByRole('button', { name: /upload additional document/i })).toBeDisabled());
    release({});
  });
});

/* ── empty states ────────────────────────────────────────────────────────── */

describe('empty states', () => {
  it('offers the upload when there is nothing at all', async () => {
    renderStep([]);
    expect(await screen.findByText(/no document requirements have been set yet/i)).toBeTruthy();
    // Points at what to do rather than stopping at what is absent.
    expect(screen.getByText(/you can still upload a document below/i)).toBeTruthy();
  });

  it('does NOT claim nothing exists when a document has been uploaded', async () => {
    // The exact reported symptom: "No document requirements have been set yet"
    // shown underneath a file the customer had just sent us.
    listDocuments.mockResolvedValue({ documents: [doc({ filename: 'passport.pdf' })] });
    renderStep([]);

    expect(await screen.findByText('passport.pdf')).toBeTruthy();
    expect(screen.queryByText(/no document requirements have been set yet/i)).toBeNull();
  });

  it('prompts against the requirements when none has been met', async () => {
    renderStep([requirement()]);
    expect(await screen.findByText(/nothing uploaded yet/i)).toBeTruthy();
    expect(screen.queryByText(/no document requirements have been set yet/i)).toBeNull();
  });

  it('shows no empty-state noise once requirements are satisfied', async () => {
    listDocuments.mockResolvedValue({
      documents: [doc({ requirement_id: 'req-1', filename: 'licence.pdf' })],
    });
    renderStep([requirement({ status: 'uploaded' })]);

    expect(await screen.findByText('licence.pdf')).toBeTruthy();
    expect(screen.queryByText(/nothing uploaded yet/i)).toBeNull();
  });
});

/* ── status ──────────────────────────────────────────────────────────────── */

describe('status', () => {
  it('translates each stored status into client language', async () => {
    listDocuments.mockResolvedValue({
      documents: [
        doc({ id: 'a', filename: 'a.pdf', status: 'uploaded' }),
        doc({ id: 'b', filename: 'b.pdf', status: 'accepted' }),
        doc({ id: 'c', filename: 'c.pdf', status: 'rejected', rejection_reason: 'The photo page was cut off. Please send the whole page.' }),
      ],
    });
    renderStep();

    expect(await screen.findByText('Received')).toBeTruthy();
    expect(screen.getByText('Accepted')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    // The staff-written reason is the one thing that tells them what to send.
    expect(screen.getByText(/the photo page was cut off/i)).toBeTruthy();
    // No raw enum reaches the page.
    expect(document.body.textContent).not.toMatch(/\brejected\b|\bsuperseded\b/);
  });

  it('shows nothing for a deleted document, because the server sends none', async () => {
    // `list_documents` filters `deleted` server-side; the client holds no
    // second opinion about which documents exist.
    listDocuments.mockResolvedValue({ documents: [] });
    renderStep();
    await waitFor(() => expect(listDocuments).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /^view/i })).toBeNull();
  });
});

/* ── errors ──────────────────────────────────────────────────────────────── */

describe('errors', () => {
  it('does not imply there are no documents when the list fails', async () => {
    listDocuments.mockRejectedValue(new Error('network'));
    renderStep([]);

    expect(await screen.findByText(/could not be loaded just now/i)).toBeTruthy();
    expect(screen.getByText(/still safely held/i)).toBeTruthy();
    expect(screen.queryByText(/no document requirements have been set yet/i)).toBeNull();
  });

  it('offers a retry that re-reads', async () => {
    listDocuments.mockRejectedValueOnce(new Error('network'));
    renderStep([]);
    const retry = await screen.findByRole('button', { name: /try again/i });

    listDocuments.mockResolvedValue({ documents: [doc({ filename: 'passport.pdf' })] });
    fireEvent.click(retry);

    expect(await screen.findByText('passport.pdf')).toBeTruthy();
    expect(screen.queryByText(/could not be loaded just now/i)).toBeNull();
  });

  it('reports a failed View without losing the row', async () => {
    listDocuments.mockResolvedValue({ documents: [doc({ filename: 'passport.pdf' })] });
    documentUrl.mockRejectedValue(new Error('Document not found'));
    renderStep();

    fireEvent.click(await screen.findByRole('button', { name: /view passport\.pdf/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByText('passport.pdf')).toBeTruthy();
  });
});

/* ── viewing ─────────────────────────────────────────────────────────────── */

describe('viewing a document', () => {
  const withDocument = (over: Record<string, unknown> = {}) => {
    listDocuments.mockResolvedValue({
      documents: [doc({ id: 'doc-9', filename: 'passport.pdf', ...over })],
    });
  };
  const clickView = async () =>
    fireEvent.click(await screen.findByRole('button', { name: /view passport\.pdf/i }));

  it('asks the server for a link, scoped to this case and document', async () => {
    withDocument();
    documentUrl.mockResolvedValue({ url: 'https://storage.test/signed?token=T', filename: 'passport.pdf' });
    renderStep();

    await clickView();

    // Both ids: a document id alone must never be enough.
    await waitFor(() => expect(documentUrl).toHaveBeenCalledWith('case-1', 'doc-9'));
  });

  it('opens the tab inside the click, BEFORE the link exists', async () => {
    /*
     * The reported bug, in one assertion. The tab used to be opened after the
     * `await`, which makes it an unsolicited popup: Safari and Firefox drop it
     * on default settings, `window.open`'s null return was never read, and
     * pressing View produced no tab and no message at all.
     */
    withDocument();
    let resolveUrl: (v: unknown) => void = () => {};
    documentUrl.mockReturnValue(new Promise((r) => { resolveUrl = r; }));
    renderStep();

    await clickView();

    // Synchronously, while the customer's gesture is still the current one.
    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(viewer.location.replace).not.toHaveBeenCalled();

    resolveUrl({ url: 'https://storage.test/signed?token=T', filename: 'passport.pdf' });

    await waitFor(() => expect(viewer.location.replace).toHaveBeenCalledWith(
      'https://storage.test/signed?token=T'));
  });

  it('severs the opened tab from this one', async () => {
    // `noopener` cannot be passed — it returns null instead of the handle the
    // navigation needs — so the reference is cut from this side instead.
    withDocument();
    documentUrl.mockResolvedValue({ url: 'https://storage.test/signed?token=T', filename: 'passport.pdf' });
    renderStep();

    await clickView();

    await waitFor(() => expect(viewer.opener).toBeNull());
  });

  it('reports a blocked window and offers it again, rather than doing nothing', async () => {
    withDocument();
    documentUrl.mockResolvedValue({ url: 'https://storage.test/signed?token=T', filename: 'passport.pdf' });
    openSpy.mockReturnValue(null);
    renderStep();

    await clickView();

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      'Your browser blocked the document window.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Open' }) }),
    ));

    // The retry runs inside its own click, which is what makes it land.
    const action = (toastError.mock.calls[0][1] as any).action;
    action.onClick();
    expect(openSpy).toHaveBeenCalledWith(
      'https://storage.test/signed?token=T', '_blank', 'noopener,noreferrer');
  });

  it('closes the blank tab when the link cannot be signed', async () => {
    // Otherwise a refusal leaves an about:blank tab standing where the
    // customer asked for their document.
    withDocument();
    documentUrl.mockRejectedValue(new Error('We could not open that document just now.'));
    renderStep();

    await clickView();

    await waitFor(() => expect(viewer.close).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith('We could not open that document just now.');
  });

  it('ignores a second document pressed while the first is still signing', async () => {
    listDocuments.mockResolvedValue({
      documents: [
        doc({ id: 'a', filename: 'passport.pdf' }),
        doc({ id: 'b', filename: 'licence.pdf' }),
      ],
    });
    documentUrl.mockReturnValue(new Promise(() => {}));
    renderStep();

    await clickView();
    fireEvent.click(screen.getByRole('button', { name: /view licence\.pdf/i }));

    // One request, one tab — not a second blank window over the first.
    await waitFor(() => expect(documentUrl).toHaveBeenCalledTimes(1));
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('never puts the signed URL in storage or on the page', async () => {
    withDocument();
    documentUrl.mockResolvedValue({ url: 'https://storage.test/signed?token=SECRET', filename: 'passport.pdf' });
    renderStep();

    await clickView();
    await waitFor(() => expect(documentUrl).toHaveBeenCalled());

    // A short-lived credential: used at the moment of the click and dropped.
    expect(JSON.stringify(window.localStorage)).not.toContain('SECRET');
    expect(JSON.stringify(window.sessionStorage)).not.toContain('SECRET');
    expect(document.body.textContent).not.toContain('SECRET');
  });
});

/* ── accessibility & layout ──────────────────────────────────────────────── */

describe('accessibility', () => {
  it('gives every action a name that says what it acts on', async () => {
    listDocuments.mockResolvedValue({
      documents: [
        doc({ id: 'a', requirement_id: 'req-1', filename: 'licence.pdf' }),
        doc({ id: 'b', requirement_id: null, filename: 'bank-statement.pdf' }),
      ],
    });
    renderStep([requirement({ status: 'uploaded' })]);

    // Otherwise a screen reader hears a column of identical "View" buttons.
    expect(await screen.findByRole('button', { name: 'View licence.pdf' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View bank-statement.pdf' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace Proof of identity' })).toBeTruthy();
  });

  it('keeps a long filename fully readable rather than clipping it away', async () => {
    const long = 'australian-drivers-licence-front-and-back-scanned-2026-08-11-final-v3.pdf';
    listDocuments.mockResolvedValue({ documents: [doc({ filename: long })] });
    renderStep();

    const name = await screen.findByText(long);
    // Wrapped, not truncated: the end of the name is the half that identifies
    // it, and a `truncate` class would hide exactly that. The full value is
    // also on `title` for a tooltip.
    expect(name.className).toContain('break-all');
    expect(name.getAttribute('title')).toBe(long);
  });

  it('does not signal status by colour alone', async () => {
    listDocuments.mockResolvedValue({
      documents: [doc({ status: 'rejected', rejection_reason: 'Please resend' })],
    });
    renderStep();
    // Every state carries a word.
    expect(await screen.findByText('Needs attention')).toBeTruthy();
  });
});
