/**
 * THE SINGLE-PROPERTY READ: WHAT `get_stock_item` HANDS THE PAGE, AND TO WHOM.
 *
 * `get_stock_item` existed and nothing called it. The property page is its
 * first caller, and it now carries the property's photographs and documents
 * (from the media converger's tables) and its activation record (the Command
 * Centre's own `builder_stock_selections`). Two rules are pinned here:
 *
 *   * every media read is pinned to the property AND its builder, so a row
 *     that somehow named another builder's property is never served;
 *   * a client is named only to a reader the Clients module admits, the same
 *     gate `list_selections` already applies — and the Command Centre's
 *     internal note never leaves the server on this path at all.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { projectPropertyDetail } from '../../../supabase/functions/_shared/builderStock/propertyDetail.pure';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

const selections = [
  {
    id: 'sel-old', status: 'withdrawn', selected_at: '2026-09-01T00:00:00Z', acknowledged_at: null,
    withdrawn_at: '2026-09-02T00:00:00Z', selected_by_user_id: 'user-1', client_id: 'client-1',
  },
  {
    id: 'sel-new', status: 'selected', selected_at: '2026-09-20T00:00:00Z', acknowledged_at: null,
    withdrawn_at: null, selected_by_user_id: 'user-2', client_id: 'client-2',
  },
];
const users = [
  { id: 'user-1', first_name: 'Sam', last_name: 'Adviser', username: 'sam' },
  { id: 'user-2', first_name: null, last_name: null, username: 'riley' },
];
const clients = [
  { id: 'client-1', primary_first_name: 'Jordan', primary_surname: 'Buyer' },
  { id: 'client-2', primary_first_name: 'Alex', primary_surname: 'Owner' },
];

describe('projectPropertyDetail', () => {
  it('orders photographs by position and serves each through its network URL', () => {
    const detail = projectPropertyDetail({
      photos: [
        { upstream_image_id: 'b', position: 1, external_url: 'https://n/img?id=b', content_type: null },
        { upstream_image_id: 'a', position: 0, external_url: 'https://n/img?id=a', content_type: 'image/jpeg' },
      ],
      documents: [], selections: [], users: [], clients: null, media: null,
    });
    expect(detail.photos).toEqual([
      { id: 'a', position: 0, url: 'https://n/img?id=a', content_type: 'image/jpeg' },
      { id: 'b', position: 1, url: 'https://n/img?id=b', content_type: null },
    ]);
  });

  it('lists the activation history newest first, naming who activated it', () => {
    const detail = projectPropertyDetail({
      photos: [], documents: [], selections, users, clients, media: null,
    });
    expect(detail.activations.map((a) => a.id)).toEqual(['sel-new', 'sel-old']);
    expect(detail.activations.map((a) => a.activated_by)).toEqual(['riley', 'Sam Adviser']);
    expect(detail.clients_visible).toBe(true);
    expect(detail.activations[0].client).toEqual({ id: 'client-2', name: 'Alex Owner' });
  });

  it('names no client when the reader may not see clients', () => {
    const detail = projectPropertyDetail({
      photos: [], documents: [], selections, users, clients: null, media: null,
    });
    expect(detail.clients_visible).toBe(false);
    for (const activation of detail.activations) {
      expect(activation.client).toBeNull();
      expect(JSON.stringify(activation)).not.toContain('client-');
    }
  });

  it('never carries an internal note or a raw user id', () => {
    const detail = projectPropertyDetail({
      photos: [], documents: [],
      selections: selections.map((s) => ({ ...s, internal_notes: 'confidential' })),
      users, clients, media: null,
    });
    const serialised = JSON.stringify(detail);
    expect(serialised).not.toContain('confidential');
    expect(serialised).not.toContain('user-1');
  });
});

describe('the edge read', () => {
  const fn = read('supabase/functions/builder-stock-marketplace/index.ts');
  const io = read('supabase/functions/_shared/builderStock/propertyDetail.ts');
  const op = fn.slice(fn.indexOf("operation === 'get_stock_item'"), fn.indexOf("operation === 'list_builders'"));

  it('get_stock_item reads the property detail beside the existing record', () => {
    expect(op).toContain('decorate(supabase, [item])');
    expect(op).toContain('readPropertyDetail(');
  });

  it('asks the Clients module before any client is named', () => {
    expect(op).toMatch(/requireModulePermission\(supabase, actor, 'clients', 'can_view'\)/);
    expect(op).toMatch(/includeClients:\s*clientsView\.ok/);
  });

  it('pins every media read to the property AND its builder', () => {
    for (const table of ['builder_network_stock_item_photos', 'builder_network_stock_item_documents', 'builder_network_stock_item_media']) {
      const at = io.indexOf(`from('${table}')`);
      expect(at).toBeGreaterThan(-1);
      const statement = io.slice(at, at + 400);
      expect(statement).toContain(".eq('stock_item_id', item.id)");
      expect(statement).toContain(".eq('organisation_id', item.organisation_id)");
    }
  });

  it('never selects the internal note, and reads clients only when admitted', () => {
    const selection = io.slice(io.indexOf("from('builder_stock_selections')"));
    const select = selection.match(/\.select\('([^']*)'\)/)?.[1] ?? '';
    expect(select).not.toContain('internal_notes');
    expect(io).toMatch(/includeClients[\s\S]{0,200}from\('clients'\)/);
  });
});
