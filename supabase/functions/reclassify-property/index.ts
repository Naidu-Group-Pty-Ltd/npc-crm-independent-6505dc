// Superadmin-only edge function to move a property between
// client_properties / commercial_properties / industrial_properties.
//
// Strategy: copy → log → delete source. Field mapping is best-effort; the
// full source row is preserved in `source_snapshot` for forensic recovery.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { verifyAuthOrNativeUser } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { internalError } from '../_shared/errorResponse.ts';

type AssetClass = 'residential' | 'commercial' | 'industrial';

const TABLE: Record<AssetClass, string> = {
  residential: 'client_properties',
  commercial: 'commercial_properties',
  industrial: 'industrial_properties',
};

function addressOf(row: any, source: AssetClass): { address: string; suburb?: string; state?: string; postcode?: string } {
  if (source === 'residential') return { address: row.address ?? '' };
  if (source === 'commercial')  return { address: row.address ?? '', suburb: row.suburb, state: row.state, postcode: row.postcode };
  return { address: [row.property_name, row.street].filter(Boolean).join(' — '), suburb: row.suburb, state: row.state, postcode: row.postcode };
}

function mapPayload(row: any, source: AssetClass, target: AssetClass, userId: string | null): Record<string, any> {
  const addr = addressOf(row, source);
  const purchase_price = row.purchase_price ?? row.value ?? null;
  const valuation = row.valuation ?? row.current_valuation ?? row.value ?? null;
  const valuation_date = row.valuation_date ?? null;
  const purchase_date = row.purchase_date ?? row.acquisition_date ?? null;
  const year_built = row.year_built ?? null;
  const notes = row.notes ?? row.sourced_notes ?? null;

  if (target === 'residential') {
    return {
      client_id: row.client_id,
      property_type: 'investment',
      address: [addr.address, addr.suburb, addr.state, addr.postcode].filter(Boolean).join(', '),
      value: valuation ?? purchase_price ?? 0,
      purchase_price, purchase_date,
      loan_remaining: row.industrial_financing?.loan_balance ?? 0,
      interest_rate: row.industrial_financing?.interest_rate ?? 0,
      sourced_notes: notes,
    };
  }
  if (target === 'commercial') {
    return {
      client_id: row.client_id,
      user_id: userId,
      address: addr.address,
      suburb: addr.suburb ?? null,
      state: addr.state ?? null,
      postcode: addr.postcode ?? null,
      asset_class: 'office',
      tenure: 'freehold',
      gst_treatment: 'going_concern',
      purchase_price,
      acquisition_date: purchase_date,
      valuation, valuation_date,
      year_built,
      notes,
    };
  }
  // industrial
  return {
    client_id: row.client_id,
    user_id: userId,
    property_name: addr.address?.split(',')[0] ?? null,
    street: addr.address?.split(',')[0] ?? null,
    suburb: addr.suburb ?? null,
    state: addr.state ?? null,
    postcode: addr.postcode ?? null,
    asset_subtype: 'warehouse',
    purchase_price,
    purchase_date,
    current_valuation: valuation,
    valuation_date,
    year_built,
    notes,
    industrial_financing: source === 'residential' ? {
      loan_balance: row.loan_remaining ?? 0,
      interest_rate: row.interest_rate ?? 0,
      loan_term_years: 25,
    } : {},
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(SUPABASE_URL, SERVICE);
    const body = await req.json().catch(() => ({}));

    // Support both the application's custom staff auth and native Supabase Auth.
    const auth = await verifyAuthOrNativeUser(admin, req, body);
    const userId = auth.userId;
    if (auth.error || !userId) return new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: roleData } = await admin.from('user_roles').select('role').eq('user_id', userId).eq('role', 'superadmin').maybeSingle();
    if (!roleData) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { action, source, target, propertyId, dryRun } = body as {
      action?: 'preview' | 'execute' | 'list';
      source?: AssetClass; target?: AssetClass; propertyId?: string; dryRun?: boolean;
    };

    if (action === 'list') {
      const clientId = body.clientId as string | undefined;
      if (!clientId) return new Response(JSON.stringify({ error: 'clientId required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const [r, c, i] = await Promise.all([
        admin.from('client_properties').select('id, address, value, property_type').eq('client_id', clientId),
        admin.from('commercial_properties').select('id, address, suburb, valuation, purchase_price').eq('client_id', clientId),
        admin.from('industrial_properties').select('id, property_name, street, suburb, current_valuation, purchase_price').eq('client_id', clientId),
      ]);
      return new Response(JSON.stringify({
        residential: r.data ?? [], commercial: c.data ?? [], industrial: i.data ?? [],
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!source || !target || !propertyId || source === target) {
      return new Response(JSON.stringify({ error: 'source, target (distinct), propertyId required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: row, error: readErr } = await admin.from(TABLE[source]).select('*').eq('id', propertyId).maybeSingle();
    if (readErr || !row) return new Response(JSON.stringify({ error: readErr?.message ?? 'not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const payload = mapPayload(row, source, target, userId);

    if (action === 'preview' || dryRun) {
      return new Response(JSON.stringify({ preview: true, payload, sourceSnapshot: row }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Insert into target
    const { data: inserted, error: insErr } = await admin.from(TABLE[target]).insert(payload).select('id').single();
    if (insErr) {
      await admin.from('property_reclassification_log').insert({
        client_id: row.client_id, source_table: TABLE[source], source_property_id: propertyId,
        target_table: TABLE[target], mapped_payload: payload, source_snapshot: row,
        status: 'failed', error_message: insErr.message, performed_by: userId,
      });
      return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Delete source
    const { error: delErr } = await admin.from(TABLE[source]).delete().eq('id', propertyId);
    if (delErr) {
      await admin.from('property_reclassification_log').insert({
        client_id: row.client_id, source_table: TABLE[source], source_property_id: propertyId,
        target_table: TABLE[target], target_property_id: inserted.id, mapped_payload: payload, source_snapshot: row,
        status: 'failed', error_message: `source delete failed: ${delErr.message}`, performed_by: userId,
      });
      return new Response(JSON.stringify({ error: delErr.message, newId: inserted.id, warning: 'target row was inserted but source delete failed — manual cleanup required' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await admin.from('property_reclassification_log').insert({
      client_id: row.client_id, source_table: TABLE[source], source_property_id: propertyId,
      target_table: TABLE[target], target_property_id: inserted.id, mapped_payload: payload, source_snapshot: row,
      status: 'completed', performed_by: userId,
    });

    return new Response(JSON.stringify({ ok: true, newId: inserted.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify(internalError(e, 'reclassify-property')), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
