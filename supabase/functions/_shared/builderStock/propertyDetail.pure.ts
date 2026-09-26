/**
 * BUILDER STOCK — WHAT THE PROPERTY PAGE IS HANDED BESIDE THE PROPERTY.
 *
 * `get_stock_item` returns the same decorated record a marketplace card is
 * drawn from. The page needs three more things, and this is the one place that
 * shapes them:
 *
 *   * the photographs the Builders Network published for the property, in the
 *     order it sent them (the media converger's rows — the Command Centre
 *     elects nothing);
 *   * the documents the builder's own row links to, typed and labelled as the
 *     builder filed them;
 *   * the activation record — the Command Centre's own `builder_stock_selections`
 *     — newest first, naming who activated it.
 *
 * A CLIENT IS NAMED ONLY WHERE THE READER MAY SEE CLIENTS. `clients` is null
 * when the Clients module did not admit the reader, and then no client id or
 * name is emitted at all — not an empty name beside an id. The Command
 * Centre's internal note and every raw user id stay on the server: the
 * projection copies named fields, so a column added to a select later cannot
 * leak through a spread.
 *
 * Pure: no IO. Loaded by the edge function under Deno and by vitest.
 */

export type PropertyDocumentKind = 'brochure' | 'floor_plan' | 'site_plan' | 'estate' | 'other';

export interface PropertyPhoto {
  id: string;
  position: number;
  url: string;
  content_type: string | null;
}

export interface PropertyDocument {
  key: string;
  kind: PropertyDocumentKind;
  label: string;
  url: string;
}

export interface PropertyActivation {
  id: string;
  status: string;
  selected_at: string;
  acknowledged_at: string | null;
  withdrawn_at: string | null;
  activated_by: string | null;
  client: { id: string; name: string } | null;
}

export interface PropertyDetail {
  photos: PropertyPhoto[];
  documents: PropertyDocument[];
  activations: PropertyActivation[];
  clients_visible: boolean;
  /** When the network's media for this property last converged; null if never. */
  media_synced_at: string | null;
}

interface PhotoRow {
  upstream_image_id: string;
  position: number;
  external_url: string;
  content_type: string | null;
}
interface DocumentRow {
  document_key: string;
  position?: number;
  kind: string;
  label: string;
  url: string;
}
interface SelectionRow {
  id: string;
  status: string;
  selected_at: string;
  acknowledged_at: string | null;
  withdrawn_at: string | null;
  selected_by_user_id: string | null;
  client_id: string | null;
}
interface UserRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
}
interface ClientRow {
  id: string;
  primary_first_name: string | null;
  primary_surname: string | null;
}

const KINDS: ReadonlySet<string> = new Set(['brochure', 'floor_plan', 'site_plan', 'estate', 'other']);

function personName(user: UserRow | undefined): string | null {
  if (!user) return null;
  const full = [user.first_name, user.last_name]
    .map((part) => String(part ?? '').trim()).filter(Boolean).join(' ');
  return full || String(user.username ?? '').trim() || null;
}

export function projectPropertyDetail(input: {
  photos: PhotoRow[] | null;
  documents: DocumentRow[] | null;
  selections: SelectionRow[] | null;
  users: UserRow[] | null;
  /** Null when the reader may not see clients. */
  clients: ClientRow[] | null;
  media: { applied_at: string } | null;
}): PropertyDetail {
  const photos = [...(input.photos ?? [])]
    .sort((a, b) => a.position - b.position
      || String(a.upstream_image_id).localeCompare(String(b.upstream_image_id)))
    .slice(0, 12)
    .map((row) => ({
      id: row.upstream_image_id,
      position: row.position,
      url: row.external_url,
      content_type: row.content_type ?? null,
    }));

  const documents = [...(input.documents ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)
      || a.document_key.localeCompare(b.document_key))
    .filter((row) => /^https?:\/\//i.test(row.url))
    .slice(0, 12)
    .map((row) => ({
      key: row.document_key,
      kind: (KINDS.has(row.kind) ? row.kind : 'other') as PropertyDocumentKind,
      label: row.label,
      url: row.url,
    }));

  const userById = new Map((input.users ?? []).map((user) => [user.id, user]));
  const clientsVisible = input.clients !== null;
  const clientById = new Map((input.clients ?? []).map((client) => [client.id, client]));

  const activations = [...(input.selections ?? [])]
    .sort((a, b) => String(b.selected_at).localeCompare(String(a.selected_at)))
    .map((row) => {
      const client = clientsVisible && row.client_id ? clientById.get(row.client_id) : undefined;
      const clientName = client
        ? [client.primary_first_name, client.primary_surname]
          .map((part) => String(part ?? '').trim()).filter(Boolean).join(' ')
        : '';
      return {
        id: row.id,
        status: row.status,
        selected_at: row.selected_at,
        acknowledged_at: row.acknowledged_at ?? null,
        withdrawn_at: row.withdrawn_at ?? null,
        activated_by: personName(row.selected_by_user_id ? userById.get(row.selected_by_user_id) : undefined),
        client: client ? { id: client.id, name: clientName || 'Client' } : null,
      };
    });

  return {
    photos,
    documents,
    activations,
    clients_visible: clientsVisible,
    media_synced_at: input.media?.applied_at ?? null,
  };
}
