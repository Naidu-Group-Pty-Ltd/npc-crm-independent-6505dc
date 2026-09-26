/**
 * The reads behind the property page, for `get_stock_item`.
 *
 * Every media read names the property AND the builder that owns it. The media
 * converger already refuses to attach media to another builder's property, so
 * this is the second of two locks rather than the only one — the one that
 * holds at the moment bytes are pointed at.
 *
 * A read that fails is logged and answers empty, never throws: the page's
 * property record is already in hand, and a missing gallery must not take it
 * away (the rule the converger itself was built around).
 */
import { projectPropertyDetail, type PropertyDetail } from './propertyDetail.pure.ts';

const ACTIVATION_SELECT = 'id, status, selected_at, acknowledged_at, withdrawn_at, selected_by_user_id, client_id';

export async function readPropertyDetail(
  supabase: any,
  item: { id: string; organisation_id: string },
  options: { includeClients: boolean },
): Promise<PropertyDetail> {
  const quietly = async <T>(label: string, run: () => PromiseLike<{ data: T | null; error: any }>) => {
    try {
      const { data, error } = await run();
      if (error) {
        console.warn(`[builder-stock-marketplace] property detail: ${label} read failed`, error.message);
        return null;
      }
      return data;
    } catch (error) {
      console.warn(`[builder-stock-marketplace] property detail: ${label} read threw`, error);
      return null;
    }
  };

  const [photos, documents, media, selections] = await Promise.all([
    quietly<any[]>('photos', () => supabase
      .from('builder_network_stock_item_photos')
      .select('upstream_image_id, position, external_url, content_type')
      .eq('stock_item_id', item.id)
      .eq('organisation_id', item.organisation_id)
      .order('position', { ascending: true })),
    quietly<any[]>('documents', () => supabase
      .from('builder_network_stock_item_documents')
      .select('document_key, position, kind, label, url')
      .eq('stock_item_id', item.id)
      .eq('organisation_id', item.organisation_id)
      .order('position', { ascending: true })),
    quietly<any>('media', () => supabase
      .from('builder_network_stock_item_media')
      .select('applied_at')
      .eq('stock_item_id', item.id)
      .eq('organisation_id', item.organisation_id)
      .maybeSingle()),
    quietly<any[]>('activations', () => supabase
      .from('builder_stock_selections')
      .select(ACTIVATION_SELECT)
      .eq('stock_item_id', item.id)
      .order('selected_at', { ascending: false })
      .limit(50)),
  ]);

  const userIds = Array.from(new Set((selections ?? [])
    .map((row: any) => row.selected_by_user_id).filter(Boolean)));
  const clientIds = Array.from(new Set((selections ?? [])
    .map((row: any) => row.client_id).filter(Boolean)));

  const [users, clients] = await Promise.all([
    userIds.length
      ? quietly<any[]>('users', () => supabase
        .from('custom_users').select('id, first_name, last_name, username').in('id', userIds))
      : Promise.resolve([]),
    // Only for a reader the Clients module admitted; otherwise null, and the
    // projection names no client at all.
    options.includeClients
      ? (clientIds.length
        ? quietly<any[]>('clients', () => supabase
          .from('clients').select('id, primary_first_name, primary_surname').in('id', clientIds))
          .then((rows) => rows ?? [])
        : Promise.resolve([]))
      : Promise.resolve(null),
  ]);

  return projectPropertyDetail({
    photos, documents, selections, users,
    clients: options.includeClients ? (clients ?? []) : null,
    media,
  });
}
