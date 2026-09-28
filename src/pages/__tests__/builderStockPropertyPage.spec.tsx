/**
 * A BUILDER PROPERTY IS A PAGE WITH AN ADDRESS.
 *
 * The Builder Stock card had no click and the map sent a stock pin to the
 * tab, not to the property — so the only way to "open" a builder's property
 * was to find its card again. These pin the page, the route that makes it
 * bookmarkable, the ways in, and what the page states: the builder's own
 * figures and documents, and the activation record exactly as the Command
 * Centre holds it. Nothing on it is written by a model.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarketplaceStockDetail } from '@/lib/marketplaceBuilderStock';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

let permissions = { canView: true, canEdit: true };
vi.mock('@/hooks/useModulePermissions', () => ({
  useModulePermissions: () => ({
    ...permissions, canDelete: false, includedInPlan: true, decision: null, loading: false,
  }),
}));

let detail: MarketplaceStockDetail | null = null;
let requested: string | null = null;
vi.mock('@/lib/marketplaceBuilderStock', async (original) => ({
  ...(await original<typeof import('@/lib/marketplaceBuilderStock')>()),
  useMarketplaceStockItem: (id: string) => {
    requested = id;
    return { data: detail, isLoading: false, error: null, refetch: vi.fn() };
  },
  useMarketplaceClientSearch: () => ({ data: { records: [] }, isLoading: false }),
  useSelectBuilderStockForClient: () => ({ mutate: vi.fn(), isPending: false }),
  // Since Step 6 the card lists the reader's own conversations about the
  // property (docs/builder-portal/52).
  useMyBuilderConversations: () => ({
    data: { conversations: [{ conversation_id: 'conv-1', stock_item_id: 'stock-1', address: '12 Proof Street',
      lot_number: '324', builder_name: 'Proof Homes', status: 'acknowledged', last_message_at: null }] },
    isLoading: false, error: null,
  }),
  useParticipantConversation: () => ({
    data: { conversation_id: 'conv-1', open: true, can_send: true, can_invite: true, can_leave: false, participants: [], messages: [] },
    isLoading: false, error: null,
  }),
  useSendConversationMessage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRetryConversationMessage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConversationInvitees: () => ({ data: [], isLoading: false, error: null }),
  useInviteConversationParticipant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLeaveConversation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const record = {
  id: 'stock-1', organisation_id: 'org-1', lot_number: '324', address_line: '12 Proof Street',
  suburb: 'Testville', state: 'VIC', postcode: '3000', development_name: 'Proof Estate',
  project_name: null, bedrooms: 4, bathrooms: 2, car_spaces: 2, building_size_sqm: 212.4,
  land_size_sqm: 400, price: 650000, price_display: '$650,000', availability_status: 'available',
  expected_completion: 'Titles Q2 2027', description: 'A four-bedroom home on a corner lot.',
  lifecycle_status: 'active', external_reference: 'PH-324', house_design: 'Harbour 28',
  last_seen_at: '2026-09-25T02:00:00Z', images: [], selections: [],
  builder_organisation: { id: 'org-1', legal_name: 'Proof Homes Pty Ltd', trading_name: 'Proof Homes' },
} as unknown as MarketplaceStockDetail['record'];

const baseDetail = (): MarketplaceStockDetail => ({
  record,
  photos: [{ id: 'photo-1', position: 0, url: 'https://network.example/img?id=photo-1', content_type: 'image/jpeg' }],
  documents: [
    { key: 'a'.repeat(32), kind: 'brochure', label: 'Brochure', url: 'https://example.com/brochure.pdf' },
    { key: 'b'.repeat(32), kind: 'floor_plan', label: 'Floor Plan', url: 'https://example.com/floor.pdf' },
  ],
  activations: [{
    id: 'sel-1', status: 'builder_acknowledged', selected_at: '2026-09-20T01:30:00Z',
    acknowledged_at: '2026-09-21T03:00:00Z', withdrawn_at: null,
    activated_by: 'Sam Adviser', client: { id: 'client-1', name: 'Jordan Buyer' },
  }],
  clients_visible: true,
  media_synced_at: '2026-09-25T02:01:00Z',
});

async function renderAt(path: string) {
  const { default: BuilderStockProperty } = await import('@/pages/BuilderStockProperty');
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/listings/builder-stock/:stockItemId" element={<BuilderStockProperty />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  permissions = { canView: true, canEdit: true };
  detail = baseDetail();
  requested = null;
});

describe('the route', () => {
  it('is declared, bookmarkable, behind the Listings module', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(
      /path="listings\/builder-stock\/:stockItemId"[\s\S]{0,200}<ModuleGuard moduleKey="listings">/,
    );
  });

  it('reads the property named by the URL', async () => {
    await renderAt('/listings/builder-stock/stock-1');
    expect(requested).toBe('stock-1');
  });

  it('the card opens the property\'s own page', () => {
    const tab = read('src/components/listings/BuilderStockTab.tsx');
    expect(tab).toContain('builderStockPropertyPath(item.id)');
  });

  it('a stock pin on the map opens the property\'s own page, not the tab', () => {
    const listings = read('src/pages/Listings.tsx');
    expect(listings).toMatch(/onOpenBuilderStock=\{\(stockItemId\)\s*=>\s*navigate\(builderStockPropertyPath\(stockItemId\)\)\}/);
  });
});

describe('what the page states', () => {
  it('the builder\'s figures, place and builder', async () => {
    await renderAt('/listings/builder-stock/stock-1');
    expect(screen.getAllByText(/12 Proof Street/).length).toBeGreaterThan(0);
    expect(screen.getByText('$650,000')).toBeTruthy();
    expect(screen.getByText('Proof Homes')).toBeTruthy();
    expect(screen.getByText(/Lot 324/)).toBeTruthy();
    expect(screen.getByText('Proof Estate')).toBeTruthy();
    expect(screen.getByText('Harbour 28')).toBeTruthy();
    expect(screen.getByText(/212 m²/)).toBeTruthy();
    expect(screen.getByText(/400 m²/)).toBeTruthy();
    expect(screen.getByText('Titles Q2 2027')).toBeTruthy();
    expect(screen.getByText(/four-bedroom home on a corner lot/)).toBeTruthy();
  });

  it('the documents, as typed links that open the builder\'s own file', async () => {
    await renderAt('/listings/builder-stock/stock-1');
    const list = screen.getByRole('list', { name: /documents/i });
    const links = within(list).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Brochure'), expect.stringContaining('Floor Plan')]),
    );
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });

  it('carries the conversation with the property\'s builder', async () => {
    await renderAt('/listings/builder-stock/stock-1');
    expect(screen.getByRole('heading', { name: /messages with proof homes/i })).toBeInTheDocument();
  });

  it('the activation record: status, who, when — and the client where the reader may see clients', async () => {
    await renderAt('/listings/builder-stock/stock-1');
    const section = screen.getByRole('region', { name: /activation/i });
    expect(within(section).getByText(/Acknowledged by builder/i)).toBeTruthy();
    expect(within(section).getByText(/Sam Adviser/)).toBeTruthy();
    expect(within(section).getByText(/Jordan Buyer/)).toBeTruthy();
  });

  it('no client name where the server withheld it', async () => {
    detail = { ...baseDetail(), clients_visible: false };
    detail.activations = detail.activations.map((a) => ({ ...a, client: null }));
    await renderAt('/listings/builder-stock/stock-1');
    expect(screen.queryByText(/Jordan Buyer/)).toBeNull();
  });

  it('offers Activate only to somebody who may activate', async () => {
    await renderAt('/listings/builder-stock/stock-1');
    expect(screen.getByRole('button', { name: /activate builder/i })).toBeTruthy();
  });

  it('withholds Activate from a reader without client edit permission', async () => {
    permissions = { canView: true, canEdit: false };
    await renderAt('/listings/builder-stock/stock-1');
    const button = screen.queryByRole('button', { name: /activate builder/i }) as HTMLButtonElement | null;
    expect(button === null || button.disabled).toBe(true);
  });

  it('a property the builder stopped listing still opens, with its conversation, and offers no activation', async () => {
    detail = { ...baseDetail(), record: { ...record, lifecycle_status: 'archived' } as typeof record };
    await renderAt('/listings/builder-stock/stock-1');
    expect(screen.getByText(/no longer listed by the builder/i)).toBeTruthy();
    expect(screen.getByRole('heading', { name: /messages with/i })).toBeTruthy();
    const button = screen.queryByRole('button', { name: /activate builder/i }) as HTMLButtonElement | null;
    expect(button === null || button.disabled).toBe(true);
  });

  it('says a property is gone rather than drawing an empty page', async () => {
    detail = null;
    await renderAt('/listings/builder-stock/missing');
    expect(screen.getByText(/not available/i)).toBeTruthy();
  });
});

describe('a frontend published ahead of its function', () => {
  it('opens on the old read (the record alone): the card picture, no documents, no activation yet', async () => {
    // What `get_stock_item` answered before this page existed, and what any
    // deployment whose functions have not caught up still answers.
    detail = { record } as unknown as MarketplaceStockDetail;
    await renderAt('/listings/builder-stock/stock-1');
    expect(screen.getByText('$650,000')).toBeTruthy();
    expect(screen.queryByRole('list', { name: /documents/i })).toBeNull();
    expect(within(screen.getByRole('region', { name: /activation/i }))
      .getByText(/not activated/i)).toBeTruthy();
  });
});

describe('nothing on the page is written by a model', () => {
  it('names no model provider', () => {
    const page = read('src/pages/BuilderStockProperty.tsx');
    expect(page).not.toMatch(/openrouter|anthropic|openai|llm|summar/i);
  });
});
