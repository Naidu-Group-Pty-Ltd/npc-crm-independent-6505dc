/**
 * The public acknowledgement page, RENDERED.
 *
 * This page is reached from an emailed link by somebody outside every portal,
 * with no account, no session and nobody to tell if it fails — the browser's
 * top-level error boundary answers a crash with "Something went wrong", which
 * is indistinguishable from a bad link. Production met exactly that, because
 * every other guard over this surface reads source rather than mounting it.
 *
 * So each of the page's five readings is mounted here: loading, invalid,
 * live, and the terminal states. The public client is stubbed — the server's
 * own rules are tested against the edge function — and the brand lockup is
 * stubbed because it needs a provider the router mounts, not this page.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicAcknowledgementView } from '@/lib/aml/partnerAcknowledgementPublic';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ token: 'a'.repeat(64) }),
}));

vi.mock('@/components/branding/BrandAssets', () => ({
  BrandLockup: () => <div data-testid="brand-lockup" />,
}));

const view = vi.fn();
vi.mock('@/lib/aml/partnerAcknowledgementPublic', () => ({
  partnerAcknowledgementPublicApi: {
    view: (...args: unknown[]) => view(...args),
    accept: vi.fn(),
    decline: vi.fn(),
  },
}));

import PartnerAcknowledgement from '@/pages/PartnerAcknowledgement';

const liveView: PublicAcknowledgementView = {
  status: 'sent',
  organisation_name: 'Harbour Legal',
  recipient_name: 'Jordan Lee',
  recipient_email: 'jordan@harbourlegal.example',
  expires_at: '2026-09-30T00:00:00.000Z',
  accepted_at: null,
  declined_at: null,
  issuer_name: 'NPC Services',
  terms: {
    version: '1.0',
    title: 'AML/CTF Compliance Passport Link Agreement',
    content_markdown: '# Agreement\n\nSection 1. The partner agrees.',
  },
  acknowledgements: [],
};

describe('PartnerAcknowledgement', () => {
  beforeEach(() => {
    view.mockReset();
  });

  it('renders the agreement, the signer field and the decline route on a live link', async () => {
    view.mockResolvedValue({ acknowledgement: liveView });
    render(<PartnerAcknowledgement />);

    expect(
      await screen.findByText(/has asked Harbour Legal to accept/i),
    ).toBeInTheDocument();

    // The instrument itself, drawn by the shared consent wall.
    expect(screen.getByText('Section 1. The partner agrees.')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);

    // `beforeAccept` — the one thing a portal gets for free and this page
    // has to ask for. Its absence is what crashed the page in production.
    expect(screen.getByLabelText(/full name of the person accepting/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Jordan Lee')).toBeInTheDocument();

    // The three facts a signatory wants before reading the agreement.
    expect(screen.getByText('One link — no portal account')).toBeInTheDocument();
    expect(screen.getByText('90 days, re-issuable')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /decline this request/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept/i })).toBeDisabled();
  });

  it('names a link that could not be read rather than crashing', async () => {
    view.mockRejectedValue(new Error('This link is not valid.'));
    render(<PartnerAcknowledgement />);

    expect(await screen.findByText('This link is not valid')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it.each([
    ['accepted', /agreement accepted/i],
    ['declined', /agreement declined/i],
    ['expired', /this link has expired/i],
    ['superseded', /this link has been replaced/i],
  ] as const)('renders the %s reading without the consent wall', async (status, heading) => {
    view.mockResolvedValue({
      acknowledgement: { ...liveView, status, accepted_at: '2026-08-20T00:00:00.000Z' },
    });
    render(<PartnerAcknowledgement />);

    expect(await screen.findByText(heading)).toBeInTheDocument();
    // A link is answered once: nothing here can be accepted a second time.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows a loading state before the link is read', async () => {
    view.mockReturnValue(new Promise(() => {}));
    render(<PartnerAcknowledgement />);

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });
});
