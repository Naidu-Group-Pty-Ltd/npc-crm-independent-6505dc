/**
 * Render smoke + visual-contract tests for the premium Market News Feed.
 *
 * The redesign is class-level (no logic changes), so these tests pin the
 * pieces that carry the visual grammar: the aurora hero with the eyebrow
 * signature, the weighted KPI tiles, the impact rail on every feed card, and
 * the lead-story treatment that only appears when the top of the feed is
 * genuinely consequential.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketUpdate } from '@/types/marketUpdates';

vi.mock('@/services/marketUpdatesService', () => ({
  fetchMarketUpdates: vi.fn(async (filters?: { status?: string }) => (filters?.status === 'candidate' ? [] : mockUpdates)),
  fetchMarketSourceHealth: vi.fn(async () => ({
    totalSources: 12, enabledSources: 10, healthySources: 9, degradedSources: 1, failedSources: 0,
    lastSuccessAt: new Date().toISOString(),
    automation: { cronStale: false, lastIngestionDispatchAt: new Date().toISOString() },
  })),
  fetchLatestMarketDigest: vi.fn(async () => null),
  generateMarketDigest: vi.fn(),
  publishMarketUpdate: vi.fn(),
  archiveMarketUpdate: vi.fn(),
  restoreMarketUpdate: vi.fn(),
  answerMarketUpdateQuestion: vi.fn(),
  streamMarketUpdateQuestion: vi.fn(),
  ensureMarketUpdatesFresh: vi.fn(async () => null),
  MarketUpdatesOperationalError: class extends Error { issue = {}; },
}));
vi.mock('@/hooks/useModulePermissions', () => ({ useModulePermissions: () => ({ canEdit: false, canView: true }) }));
vi.mock('@/components/market-updates/MarketQAVoiceButton', () => ({ MarketQAVoiceButton: () => null }));
vi.mock('@/components/market-updates/MarketSourcesAdminDialog', () => ({ MarketSourcesAdminDialog: () => null }));
vi.mock('@/components/agentModels', () => ({ LiveModelBadge: () => null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() }, auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } } }));

const baseUpdate = (over: Partial<MarketUpdate>): MarketUpdate => ({
  id: over.id ?? 'u1',
  source_name: 'ABC News Business',
  source_url: 'https://example.test/article',
  source_published_at: new Date().toISOString(),
  ingested_at: new Date().toISOString(),
  title: 'Sample update title',
  category: 'finance',
  segments: ['finance'],
  freshness_tier: 'today',
  geography: ['NSW'],
  impact_level: 'medium',
  audience_tags: [],
  key_points: [],
  risk_flags: [],
  citation_urls: [],
  relevance_score: 5,
  status: 'published',
  dedupe_hash: over.id ?? 'u1',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
} as MarketUpdate);

/*
 * The feed orders by `source_published_at` DESC, and both fixtures used to
 * stamp it `new Date()` at module load — so which story led depended on
 * whether evaluation crossed a millisecond boundary between the two calls,
 * and only the stable sort's tie-break ever put the breaking story first.
 * The ordering under test is stated explicitly instead.
 */
const mockUpdates: MarketUpdate[] = [
  baseUpdate({
    id: 'lead', title: 'Breaking lead story headline',
    freshness_tier: 'breaking', impact_level: 'critical',
    source_published_at: new Date().toISOString(),
  }),
  baseUpdate({
    id: 'second', title: 'Routine second story',
    source_name: 'Domain Research and News', impact_level: 'low',
    source_published_at: new Date(Date.now() - 60_000).toISOString(),
  }),
];

import MarketUpdates from '@/pages/MarketUpdates';

const renderPage = () => render(<MemoryRouter><MarketUpdates /></MemoryRouter>);

describe('Market News Feed premium visual contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the aurora hero with the eyebrow-over-title signature and live status', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Market News Feed' })).toBeInTheDocument();
    expect(screen.getByText('Aurixa market intelligence')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/ingested/i)).toBeInTheDocument());
    // The registry chips (sources live / in shadow / failing) are deliberately absent.
    expect(screen.queryByText(/sources live/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/in shadow/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ failing/i)).not.toBeInTheDocument();
  });


  it('renders the weighted KPI tiles as filter buttons', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /Breaking now/i })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /High impact/i })).toBeInTheDocument();
  });

  it('does not render the source coverage section', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Digest period:', { exact: false })).toBeInTheDocument());
    expect(screen.queryByText('Source coverage')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Expanded source coverage')).not.toBeInTheDocument();
  });

  it('gives the top story the lead treatment only when it is consequential', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Breaking lead story headline')).toBeInTheDocument());
    expect(screen.getByText('Lead story')).toBeInTheDocument();
    // The routine story renders without a second lead eyebrow.
    expect(screen.getAllByText('Lead story')).toHaveLength(1);
  });

  it('draws the impact rail on every feed card', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Routine second story')).toBeInTheDocument());
    const articles = document.querySelectorAll('article');
    expect(articles.length).toBeGreaterThanOrEqual(2);
    for (const article of articles) {
      expect(article.querySelector('span[aria-hidden].absolute.inset-y-0.left-0')).not.toBeNull();
    }
  });

  it('keeps relative timestamps on the provenance line', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText(/Just now|m ago|h ago/).length).toBeGreaterThanOrEqual(1));
  });
});
