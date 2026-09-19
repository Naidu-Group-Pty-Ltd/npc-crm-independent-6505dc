/**
 * The desk, exercised the way somebody uses it.
 *
 * The suites either side of this one check the artefact and check the absence
 * of the retired machinery. Neither would notice the failure that actually
 * reaches a user: a button that resolves the wrong URL, a download that saves
 * the SPA's `index.html` under a `.docx` name because the file was not
 * deployed, or a section list that quietly renders nothing.
 *
 * So this drives the component and the download function directly.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgreementTemplateResources from '@/components/agreement-templates/AgreementTemplateResources';
import { downloadAgreementTemplateDocx } from '@/lib/agreements/templateDownloads';
import {
  AGREEMENT_TEMPLATE_SUMMARIES,
  TEMPLATE_NEUTRALITY_NOTICE,
  agreementTemplateContents,
  agreementTemplateFile,
} from '@/lib/agreements';

describe('the template desk', () => {
  it('offers both templates and states the position before either of them', () => {
    render(<AgreementTemplateResources onDownloadDocx={async () => {}} />);

    for (const summary of AGREEMENT_TEMPLATE_SUMMARIES) {
      expect(screen.getByText(summary.title)).toBeTruthy();
    }
    // The notice has to be reachable without opening anything.
    for (const line of TEMPLATE_NEUTRALITY_NOTICE) {
      expect(screen.getByText(line)).toBeTruthy();
    }
    expect(screen.getAllByRole('button', { name: /Word \(\.docx\)/ })).toHaveLength(2);
  });

  it('says how big the file is and which version, before it is taken', () => {
    render(<AgreementTemplateResources onDownloadDocx={async () => {}} />);
    const file = agreementTemplateFile('strategic_property_referral');
    expect(screen.getAllByText(new RegExp(`Version ${file.documentVersion}`)).length)
      .toBeGreaterThan(0);
  });

  it('lists the sections of a template when asked', async () => {
    render(<AgreementTemplateResources onDownloadDocx={async () => {}} />);
    const entries = agreementTemplateContents('strategic_property_referral');

    const [trigger] = screen.getAllByText(/What.s inside/);
    // Collapsed by default: two long contents lists stacked would bury the
    // download the page exists for.
    expect(screen.queryByText(entries[0].heading)).toBeNull();

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByText(entries[0].heading)).toBeTruthy());
    for (const entry of entries) {
      expect(screen.getByText(entry.heading)).toBeTruthy();
    }
  });

  it('downloads the template the button belongs to', async () => {
    const onDownloadDocx = vi.fn(async () => {});
    render(<AgreementTemplateResources onDownloadDocx={onDownloadDocx} />);

    fireEvent.click(screen.getAllByRole('button', { name: /Word \(\.docx\)/ })[1]);
    await waitFor(() => expect(onDownloadDocx).toHaveBeenCalledWith(
      AGREEMENT_TEMPLATE_SUMMARIES[1].key,
    ));
  });

  it('recovers when a download fails instead of staying stuck', async () => {
    // The spinner is disabled-while-busy; if a rejection did not clear it, one
    // failed download would leave the whole desk inert until a reload.
    const onDownloadDocx = vi.fn(async () => { throw new Error('nope'); });
    render(<AgreementTemplateResources onDownloadDocx={onDownloadDocx} />);

    const [button] = screen.getAllByRole('button', { name: /Word \(\.docx\)/ });
    fireEvent.click(button);
    await waitFor(() => expect(onDownloadDocx).toHaveBeenCalled());
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });
});

describe('taking the file', () => {
  const saved: { href: string; download: string }[] = [];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    saved.length = 0;
    // jsdom has no object URLs and does not navigate on a click; capture what
    // the anchor was asked to save instead.
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:stub', writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ href: this.href, download: this.download });
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches the shipped path and saves it under the document name', async () => {
    const file = agreementTemplateFile('finance_referral_commission');
    fetchMock.mockResolvedValue({
      ok: true,
      blob: async () => new Blob([new Uint8Array(file.byteLength)], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    });

    await downloadAgreementTemplateDocx('finance_referral_commission');

    expect(fetchMock).toHaveBeenCalledWith(
      `/templates/finance-portal/${file.fileName}`,
      { cache: 'no-cache' },
    );
    expect(saved).toHaveLength(1);
    expect(saved[0].download).toBe(file.fileName);
  });

  it('reaches no Edge Function and writes nothing', async () => {
    // The neutral position, as behaviour rather than as a comment: one request,
    // to a static path, and it is not the API.
    fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob([new Uint8Array(64)]) });
    await downloadAgreementTemplateDocx('strategic_property_referral');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url.startsWith('/templates/finance-portal/')).toBe(true);
    expect(url).not.toMatch(/functions\/v1|supabase|\/api\//);
  });

  it('refuses the SPA fallback rather than saving an unopenable file', async () => {
    // A missing asset answers with the app's own index.html. Saved as `.docx`
    // that is a document Word rejects, with nothing to explain why.
    fetchMock.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['<!doctype html>'], { type: 'text/html' }),
    });

    await expect(downloadAgreementTemplateDocx('strategic_property_referral')).rejects
      .toThrow(/could not be reached/);
    expect(saved).toHaveLength(0);
  });

  it('says so when the file is not there', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, blob: async () => new Blob([]) });
    await expect(downloadAgreementTemplateDocx('finance_referral_commission')).rejects
      .toThrow(/could not be reached/);
    expect(saved).toHaveLength(0);
  });
});
