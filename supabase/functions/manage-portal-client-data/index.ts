import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders } from "../_shared/auth.ts"
import { createSyncEvent } from "../_shared/client-sync.ts"
import { pickAllowed } from "../_shared/wp09Guards.ts"
import { portalWritableColumnsFor } from "../_shared/clientDataWritableColumns.ts"

/**
 * Portal-specific data management Edge Function
 * Allows portal users to update their own client data.
 * All operations are scoped to the authenticated portal user's client_id.
 * 
 * Supported operations: insert, update, delete, bulk_mark_read
 * Allowed tables are strictly whitelisted.
 */

const ALLOWED_TABLES = [
  'clients',
  'client_properties',
  'client_employment',
  'client_income_sources',
  'client_expenses',
  'client_assets',
  'client_liabilities',
  'client_portal_messages',
  'client_portal_notifications',
  'client_portal_report_requests',
  'client_address_history',
] as const;

// Tables that support insert from the portal
const INSERTABLE_TABLES = [
  'client_portal_messages',
  'client_portal_report_requests',
  'client_properties',
  'client_employment',
  'client_income_sources',
  'client_expenses',
  'client_assets',
  'client_liabilities',
  'client_address_history',
] as const;

// Tables that support delete from the portal
const DELETABLE_TABLES = [
  'client_properties',
  'client_employment',
  'client_income_sources',
  'client_expenses',
  'client_assets',
  'client_liabilities',
  'client_address_history',
] as const;

// Fields that portal users are NOT allowed to modify on the clients table
const PROTECTED_CLIENT_FIELDS = [
  'id', 'created_at', 'created_by', 'is_active', 'is_favorite',
  'deal_status', 'pipeline_status', 'pipeline_notes', 'pipeline_updated_at',
  'current_pipeline_id', 'current_stage_id', 'opportunity_status',
  'ghl_contact_id', 'ghl_opportunity_id', 'ghl_sync_status', 'ghl_last_synced_at',
  'borrowing_capacity', 'total_portfolio_value', 'total_monthly_income',
  'total_monthly_expenditure', 'total_monthly_rental_income', 'total_debt',
  'net_monthly_cash_flow', 'equity_release', 'proposed_rental_income',
  'first_deal_closed_at', 'last_note_at', 'last_review_date', 'next_review_due',
  'review_frequency', 'notes',
];

type AllowedTable = typeof ALLOWED_TABLES[number];


function normalizeAddressPayload(payload: Record<string, any>) {
  const out = { ...(payload || {}) };
  if (typeof out.address === 'string') out.address = out.address.trim();
  if (typeof out.current_address === 'string') out.current_address = out.current_address.trim();
  if (typeof out.current_suburb === 'string') out.current_suburb = out.current_suburb.trim();
  if (typeof out.current_state === 'string') out.current_state = out.current_state.trim().toUpperCase();
  if (typeof out.current_postcode === 'string') out.current_postcode = out.current_postcode.trim();
  if (typeof out.country === 'string') out.country = out.country.trim() || 'Australia';
  if (out.is_current === true && !out.address && !out.current_address && !out.current_suburb && !out.current_state && !out.current_postcode) {
    throw new Error('Current address requires at least an address line, suburb, state or postcode');
  }
  if (out.current_postcode && !/^\d{4}$/.test(String(out.current_postcode))) {
    throw new Error('Postcode must be 4 digits');
  }
  if (out.current_state && !/^[A-Z]{2,3}$/.test(String(out.current_state))) {
    throw new Error('State must be a 2–3 letter Australian state/territory code');
  }
  return out;
}

function hasAddressFields(payload: Record<string, any> | undefined) {
  if (!payload) return false;
  return ['current_address', 'current_suburb', 'current_state', 'current_postcode', 'country', 'living_situation', 'residential_status', 'address'].some((key) => key in payload);
}

async function logAddressSyncEvent(supabase: any, input: { clientId: string; entityId: string; entityTable: string; operation: string; portalUserId?: string | null; portalEmail?: string | null }) {
  await createSyncEvent(supabase, {
    clientId: input.clientId,
    entityId: input.entityId,
    entityTable: input.entityTable,
    entityType: 'address',
    sourceSurface: 'client_portal',
    sourceActorType: 'client_user',
    sourceActorName: input.portalEmail || null,
    sourceReference: input.portalUserId || null,
    sourceDetails: { operation: input.operation },
    syncStatus: 'synced',
    propagatedTo: ['internal_dashboard', 'finance_portal', 'client_portal'],
  });
}

function extractPortalToken(headers: Headers, body?: any): string | null {
  const headerToken = headers.get('x-portal-session-token');
  if (headerToken) return headerToken;
  if (body?.portal_session_token) return body.portal_session_token;
  const sessionHeader = headers.get('x-session-token');
  if (sessionHeader) return sessionHeader;
  if (body?.session_token) return body.session_token;
  return null;
}

function sanitizeClientData(data: Record<string, any>): Record<string, any> {
  const sanitized = { ...data };
  for (const field of PROTECTED_CLIENT_FIELDS) {
    delete sanitized[field];
  }
  return sanitized;
}

async function ensureStaffPortalMessageNotification(supabase: any, messageRow: any) {
  try {
    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      .contains('metadata', { message_id: messageRow.id })
      .eq('type', 'portal_message_received')
      .maybeSingle();

    if (existing?.id) return;

    const { data: client } = await supabase
      .from('clients')
      .select('primary_first_name, primary_surname, primary_email, assigned_team_user_id')
      .eq('id', messageRow.client_id)
      .maybeSingle();

    const clientName = [client?.primary_first_name, client?.primary_surname]
      .filter(Boolean)
      .join(' ') || client?.primary_email || 'a client';
    const preview = (messageRow.message || '').slice(0, 140) || '(blank message)';

    await supabase.from('notifications').insert({
      type: 'portal_message_received',
      title: `New message from ${clientName}`,
      message: preview,
      entity_id: messageRow.client_id,
      target_user_id: client?.assigned_team_user_id || null,
      metadata: {
        client_id: messageRow.client_id,
        message_id: messageRow.id,
        sender_name: messageRow.sender_name,
        link_path: `/clients?clientId=${messageRow.client_id}&tab=portal-messages`,
        source: 'manage-portal-client-data',
      },
    });
  } catch (e) {
    console.error('Failed to ensure staff portal message notification:', e);
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const sessionToken = extractPortalToken(req.headers, body);

    if (!sessionToken) {
      return new Response(
        JSON.stringify({ error: 'Authentication required', success: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate session
    const { data: session, error: sessionError } = await supabase
      .from('client_portal_sessions')
      .select(`
        *,
        client_portal_users:user_id (id, client_id, email, status)
      `)
      .eq('session_token', sessionToken)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (sessionError || !session?.client_portal_users || session.client_portal_users.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session', success: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const clientId = session.client_portal_users.client_id;
    const { operation, table, data: payload, id } = body;

    // Validate table
    if (!table || !ALLOWED_TABLES.includes(table as AllowedTable)) {
      return new Response(
        JSON.stringify({ error: `Table '${table}' is not allowed`, success: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate operation
    if (!['update', 'insert', 'delete', 'bulk_mark_read'].includes(operation)) {
      return new Response(
        JSON.stringify({ error: `Operation '${operation}' is not allowed for portal users`, success: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== BULK MARK READ ==========
    if (operation === 'bulk_mark_read') {
      if (table !== 'client_portal_notifications') {
        return new Response(
          JSON.stringify({ error: 'bulk_mark_read only allowed for notifications', success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const notificationIds: string[] = payload?.notification_ids || [];
      if (notificationIds.length === 0) {
        return new Response(
          JSON.stringify({ success: true, data: { updated: 0 } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: result, error } = await supabase
        .from('client_portal_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('client_id', clientId)
        .in('id', notificationIds)
        .eq('is_read', false)
        .select('id');

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message, success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, data: { updated: result?.length || 0 } }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== DELETE ==========
    if (operation === 'delete') {
      if (!(DELETABLE_TABLES as readonly string[]).includes(table)) {
        return new Response(
          JSON.stringify({ error: `Delete not allowed for table '${table}'`, success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!id) {
        return new Response(
          JSON.stringify({ error: 'ID required for delete', success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Verify ownership
      const { data: existing } = await supabase
        .from(table)
        .select('client_id')
        .eq('id', id)
        .single();

      if (!existing || existing.client_id !== clientId) {
        return new Response(
          JSON.stringify({ error: 'Record not found or access denied', success: false }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await supabase.from(table).delete().eq('id', id);

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message, success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create notification for internal team
      try {
        const tableLabel = table.replace('client_', '').replace(/_/g, ' ');
        await supabase.from('notifications').insert({
          type: 'client_data_updated',
          title: 'Client Deleted Record',
          message: `A client has deleted a ${tableLabel} record via the portal.`,
          metadata: { table, record_id: id, client_id: clientId },
        });
      } catch (e) {
        console.error('Failed to create notification:', e);
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== INSERT ==========
    if (operation === 'insert') {
      if (!(INSERTABLE_TABLES as readonly string[]).includes(table)) {
        return new Response(
          JSON.stringify({ error: `Insert not allowed for table '${table}'`, success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // --- Client Properties ---
      if (table === 'client_properties') {
        if (!payload?.address) {
          return new Response(
            JSON.stringify({ error: 'Property address is required', success: false }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const isRental = payload.property_type === 'rental';
        const weeklyRent = payload.weekly_rental_income ? Number(payload.weekly_rental_income) : null;
        const monthlyRent = weeklyRent ? weeklyRent * 52 / 12 : null;

        const propertyData: Record<string, any> = {
          client_id: clientId,
          address: payload.address,
          property_type: payload.property_type || 'investment',
          purchase_price: payload.purchase_price ? Number(payload.purchase_price) : null,
          value: payload.value ? Number(payload.value) : null,
          loan_remaining: isRental ? 0 : (payload.loan_remaining ? Number(payload.loan_remaining) : null),
          interest_rate: isRental ? 0 : (payload.interest_rate ? Number(payload.interest_rate) : null),
          ownership_percentage: isRental ? 0 : (payload.ownership_percentage ? Number(payload.ownership_percentage) : null),
          monthly_interest_repayment: isRental ? 0 : (payload.monthly_interest_repayment ? Number(payload.monthly_interest_repayment) : null),
          weekly_rental_income: weeklyRent,
          monthly_rental_income: monthlyRent,
          monthly_body_corporate: payload.monthly_body_corporate ? Number(payload.monthly_body_corporate) : null,
          monthly_council_rates: payload.monthly_council_rates ? Number(payload.monthly_council_rates) : null,
          monthly_water_rates: payload.monthly_water_rates ? Number(payload.monthly_water_rates) : null,
          monthly_repairs_maintenance: payload.monthly_repairs_maintenance ? Number(payload.monthly_repairs_maintenance) : null,
          monthly_property_management: payload.monthly_property_management ? Number(payload.monthly_property_management) : null,
          monthly_landlord_insurance: payload.monthly_landlord_insurance ? Number(payload.monthly_landlord_insurance) : null,
          monthly_building_insurance: payload.monthly_building_insurance ? Number(payload.monthly_building_insurance) : null,
          total_monthly_expenditure: payload.total_monthly_expenditure ? Number(payload.total_monthly_expenditure) : null,
          net_monthly_cashflow: payload.net_monthly_cashflow != null ? Number(payload.net_monthly_cashflow) : null,
          loan_repayment_amount: payload.loan_repayment_amount ? Number(payload.loan_repayment_amount) : null,
          loan_repayment_frequency: payload.loan_repayment_frequency || null,
          repayment_type: isRental ? null : (payload.repayment_type || null),
          interest_only_period_years: isRental ? null : (payload.interest_only_period_years ? Number(payload.interest_only_period_years) : null),
          sourced_by: 'client',
          sourced_notes: 'Submitted via client portal',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { data: result, error } = await supabase
          .from('client_properties')
          .insert(propertyData)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message, success: false }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          await supabase.from('notifications').insert({
            type: 'client_property_added',
            title: 'Client Added Property',
            message: `A client has added a property to their portfolio: ${payload.address}`,
            metadata: { property_id: result.id, client_id: clientId },
          });
        } catch (notifErr) {
          console.error('Failed to create notification:', notifErr);
        }

        return new Response(
          JSON.stringify({ success: true, data: result }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // --- Client Employment ---
      if (table === 'client_employment') {
        if (!payload?.employer_name) {
          return new Response(
            JSON.stringify({ error: 'Employer name is required', success: false }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const employmentData: Record<string, any> = {
          client_id: clientId,
          contact_type: payload.contact_type || 'primary',
          is_current: payload.is_current ?? true,
          employment_type: payload.employment_type || 'permanent',
          occupation_role: payload.occupation_role || null,
          employer_name: payload.employer_name,
          start_date: payload.start_date || null,
          salary_amount: payload.salary_amount ? Number(payload.salary_amount) : null,
          salary_frequency: payload.salary_frequency || 'annual',
          gross_annual_salary: payload.gross_annual_salary ? Number(payload.gross_annual_salary) : null,
          bonus: payload.bonus ? Number(payload.bonus) : null,
          commission: payload.commission ? Number(payload.commission) : null,
          overtime_essential: payload.overtime_essential ? Number(payload.overtime_essential) : null,
          overtime_non_essential: payload.overtime_non_essential ? Number(payload.overtime_non_essential) : null,
          allowance: payload.allowance ? Number(payload.allowance) : null,
          other_taxable_income: payload.other_taxable_income ? Number(payload.other_taxable_income) : null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { data: result, error } = await supabase
          .from('client_employment')
          .insert(employmentData)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message, success: false }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          await supabase.from('notifications').insert({
            type: 'client_data_updated',
            title: 'Client Added Employment',
            message: `A client has added employment details: ${payload.employer_name}`,
            metadata: { employment_id: result.id, client_id: clientId },
          });
        } catch (notifErr) {
          console.error('Failed to create notification:', notifErr);
        }

        return new Response(
          JSON.stringify({ success: true, data: result }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // --- Client Income Sources ---
      if (table === 'client_income_sources') {
        const incomeData: Record<string, any> = {
          client_id: clientId,
          contact_type: payload.contact_type || 'primary',
          source_category: payload.source_category || 'other',
          source_type: payload.source_type || 'other',
          source_name: payload.source_name || '',
          gross_annual_amount: payload.gross_annual_amount ? Number(payload.gross_annual_amount) : 0,
          input_frequency: payload.input_frequency || 'annual',
          input_amount: payload.input_amount ? Number(payload.input_amount) : 0,
          bonus: payload.bonus ? Number(payload.bonus) : 0,
          commission: payload.commission ? Number(payload.commission) : 0,
          overtime_essential: payload.overtime_essential ? Number(payload.overtime_essential) : 0,
          overtime_non_essential: payload.overtime_non_essential ? Number(payload.overtime_non_essential) : 0,
          allowance: payload.allowance ? Number(payload.allowance) : 0,
          other_taxable_income: payload.other_taxable_income ? Number(payload.other_taxable_income) : 0,
          default_shading_rate: payload.default_shading_rate ?? 0.8,
          custom_shading_rate: payload.custom_shading_rate ?? null,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { data: result, error } = await supabase
          .from('client_income_sources')
          .insert(incomeData)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message, success: false }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          await supabase.from('notifications').insert({
            type: 'client_data_updated',
            title: 'Client Added Income Source',
            message: `A client has added an income source: ${payload.source_name || payload.source_type}`,
            metadata: { income_source_id: result.id, client_id: clientId },
          });
        } catch (notifErr) {
          console.error('Failed to create notification:', notifErr);
        }

        return new Response(
          JSON.stringify({ success: true, data: result }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // --- Client Expenses ---
      if (table === 'client_expenses') {
        const expenseData: Record<string, any> = {
          client_id: clientId,
          expense_category: payload.expense_category || 'other',
          expense_name: payload.expense_name || null,
          monthly_amount: payload.monthly_amount ? Number(payload.monthly_amount) : 0,
          frequency: payload.frequency || 'monthly',
          notes: payload.notes || null,
          is_essential: payload.is_essential ?? true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { data: result, error } = await supabase
          .from('client_expenses')
          .insert(expenseData)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message, success: false }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          await supabase.from('notifications').insert({
            type: 'client_data_updated',
            title: 'Client Added Expense',
            message: `A client has added an expense: ${payload.expense_name || payload.expense_category}`,
            metadata: { expense_id: result.id, client_id: clientId },
          });
        } catch (e) { console.error('Notification error:', e); }
        return new Response(
          JSON.stringify({ success: true, data: result }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // --- Client Assets ---
      if (table === 'client_assets') {
        const assetData: Record<string, any> = {
          client_id: clientId,
          asset_type: payload.asset_type || 'other',
          description: payload.description || null,
          value: payload.value ? Number(payload.value) : 0,
          institution_name: payload.institution_name || null,
          vehicle_type: payload.vehicle_type || null,
          make_model: payload.make_model || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { data: result, error } = await supabase
          .from('client_assets')
          .insert(assetData)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message, success: false }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          await supabase.from('notifications').insert({
            type: 'client_data_updated',
            title: 'Client Added Asset',
            message: `A client has added an asset: ${payload.description || payload.asset_type}`,
            metadata: { asset_id: result.id, client_id: clientId },
          });
        } catch (e) { console.error('Notification error:', e); }

        return new Response(
          JSON.stringify({ success: true, data: result }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // --- Client Liabilities ---
      if (table === 'client_liabilities') {
        const liabilityData: Record<string, any> = {
          client_id: clientId,
          liability_type: payload.liability_type || 'other',
          provider_name: payload.provider_name || null,
          current_balance: payload.current_balance ? Number(payload.current_balance) : 0,
          credit_limit: payload.credit_limit ? Number(payload.credit_limit) : null,
          interest_rate: payload.interest_rate ? Number(payload.interest_rate) : null,
          monthly_repayment: payload.monthly_repayment ? Number(payload.monthly_repayment) : null,
          repayment_type: payload.repayment_type || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { data: result, error } = await supabase
          .from('client_liabilities')
          .insert(liabilityData)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message, success: false }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          await supabase.from('notifications').insert({
            type: 'client_data_updated',
            title: 'Client Added Liability',
            message: `A client has added a liability: ${payload.provider_name || payload.liability_type}`,
            metadata: { liability_id: result.id, client_id: clientId },
          });
        } catch (e) { console.error('Notification error:', e); }

        return new Response(
          JSON.stringify({ success: true, data: result }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // --- Client Address History ---
      if (table === 'client_address_history') {
        const addressData: Record<string, any> = normalizeAddressPayload({
          client_id: clientId,
          contact_type: payload.contact_type || 'primary',
          additional_contact_id: payload.additional_contact_id || null,
          address: payload.address || null,
          current_suburb: payload.current_suburb || null,
          current_state: payload.current_state || null,
          current_postcode: payload.current_postcode || null,
          country: payload.country || 'Australia',
          living_situation: payload.living_situation || null,
          residential_status: payload.residential_status || null,
          start_date: payload.start_date || null,
          end_date: payload.end_date || null,
          is_current: payload.is_current ?? false,
          months_at_address: payload.months_at_address || null,
          notes: payload.notes || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        const { data: result, error } = await supabase
          .from('client_address_history')
          .insert(addressData)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message, success: false }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          await supabase.from('notifications').insert({
            type: 'client_data_updated',
            title: 'Client Added Address',
            message: `A client has added an address record: ${payload.address || 'Address'}`,
            metadata: { address_id: result.id, client_id: clientId },
          });
        } catch (e) { console.error('Notification error:', e); }

        await logAddressSyncEvent(supabase, {
          clientId,
          entityId: result.id,
          entityTable: 'client_address_history',
          operation: 'insert',
          portalUserId: session.client_portal_users.id,
          portalEmail: session.client_portal_users.email,
        });

        return new Response(
          JSON.stringify({ success: true, data: result }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // --- Report Requests ---
      if (table === 'client_portal_report_requests') {
        const validTypes = ['portfolio_review', 'borrowing_capacity', 'investment_property'];
        if (!payload?.request_type || !validTypes.includes(payload.request_type)) {
          return new Response(
            JSON.stringify({ error: 'Invalid request_type', success: false }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const insertData = {
          client_id: clientId,
          portal_user_id: session.client_portal_users.id,
          request_type: payload.request_type,
          property_address: payload.property_address || null,
          client_property_id: payload.client_property_id || null,
          notes: payload.notes || null,
          status: 'pending',
          created_at: new Date().toISOString(),
        };

        const { data: result, error } = await supabase
          .from('client_portal_report_requests')
          .insert(insertData)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message, success: false }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          await supabase.from('notifications').insert({
            type: 'report_request',
            title: `New Report Request: ${payload.request_type.replace(/_/g, ' ')}`,
            message: `A client has requested a ${payload.request_type.replace(/_/g, ' ')} report.${payload.property_address ? ' Property: ' + payload.property_address : ''}`,
            metadata: { request_id: result.id, client_id: clientId, request_type: payload.request_type },
          });
        } catch (notifErr) {
          console.error('Failed to create internal notification:', notifErr);
        }

        try {
          const typeLabel = payload.request_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
          const notifTitle = 'Report Request Submitted';
          const notifMessage = `Your ${typeLabel} request has been submitted. Our team will review it shortly.${payload.property_address ? ' Property: ' + payload.property_address : ''}`;
          
          await supabase.from('client_portal_notifications').insert({
            client_id: clientId,
            title: notifTitle,
            message: notifMessage,
            type: 'success',
            category: 'document',
            action_url: '/client/reports',
          });

          const { resolveClientEmailInfo, sendPortalNotificationEmail } = await import('../_shared/portal-notification-email.ts');
          const emailInfo = await resolveClientEmailInfo(supabase, clientId);
          if (emailInfo) {
            await sendPortalNotificationEmail({
              to: emailInfo.email,
              clientFirstName: emailInfo.firstName,
              title: notifTitle,
              message: notifMessage,
              type: 'success',
              category: 'document',
              actionUrl: '/client/reports',
              companyName: emailInfo.companyName,
            });
          }
        } catch (notifErr) {
          console.error('Failed to create portal notification:', notifErr);
        }

        return new Response(
          JSON.stringify({ success: true, data: result }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // --- Messages ---
      const messageText = (payload?.message || '').toString().trim();
      if (!messageText) {
        return new Response(
          JSON.stringify({ error: 'Message is required', success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (messageText.length > 5000) {
        return new Response(
          JSON.stringify({ error: 'Message too long (max 5000)', success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const now = new Date().toISOString();
      const insertData = {
        client_id: clientId,
        portal_user_id: session.client_portal_users.id,
        sender_type: 'client',
        sender_name: payload?.sender_name || null,
        message: messageText,
        is_read: false,
        is_internal: false,
        created_at: now,
        updated_at: now,
        visibility_scope: 'command_client_private',
        thread_type: 'command_client',
        allocation_status: 'none',
        finance_allocated: false,
        permission_status: { command_centre: 'full', client_portal: 'granted', finance_portal: 'blocked' },
      };

      const { data: result, error } = await supabase
        .from('client_portal_messages')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message, success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await ensureStaffPortalMessageNotification(supabase, result);

      return new Response(
        JSON.stringify({ success: true, data: result }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== UPDATE ==========
    if (operation === 'update') {
      if (!id && table !== 'clients') {
        return new Response(
          JSON.stringify({ error: 'ID required for update', success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // WP-25 (item 15): narrow to the columns this table declares writable FROM
      // THE PORTAL, before either branch below touches it.
      //
      // `sanitizeClientData` (a denylist of 32 names) still runs underneath on
      // the `clients` branch. It is redundant now — everything it removes is
      // already absent from the allowlist — and it stays because a redundant
      // deny is free and this is the client-facing surface.
      const portalWritable = portalWritableColumnsFor(table);
      if (!portalWritable) {
        console.error(`[manage-portal-client-data] No portal column set declared for table ${table}`);
        return new Response(
          JSON.stringify({ error: `Updates to ${table} are not configured`, success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      let sanitizedPayload: Record<string, any> = pickAllowed(payload ?? {}, portalWritable);

      if (table === 'clients') {
        sanitizedPayload = sanitizeClientData(sanitizedPayload);
        if (hasAddressFields(sanitizedPayload)) sanitizedPayload = normalizeAddressPayload(sanitizedPayload);
        sanitizedPayload.updated_at = new Date().toISOString();

        const { data: result, error } = await supabase
          .from('clients')
          .update(sanitizedPayload)
          .eq('id', clientId)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message, success: false }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (hasAddressFields(sanitizedPayload)) {
          await logAddressSyncEvent(supabase, {
            clientId,
            entityId: result.id,
            entityTable: 'clients',
            operation: 'update',
            portalUserId: session.client_portal_users.id,
            portalEmail: session.client_portal_users.email,
          });
        }

        return new Response(
          JSON.stringify({ success: true, data: result }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        // For related tables, verify the record belongs to this client
        const { data: existing } = await supabase
          .from(table)
          .select('client_id')
          .eq('id', id)
          .single();

        if (!existing || existing.client_id !== clientId) {
          return new Response(
            JSON.stringify({ error: 'Record not found or access denied', success: false }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        delete sanitizedPayload.client_id;
        delete sanitizedPayload.id;
        if (table === 'client_address_history') sanitizedPayload = normalizeAddressPayload(sanitizedPayload);
        sanitizedPayload.updated_at = new Date().toISOString();

        const { data: result, error } = await supabase
          .from(table)
          .update(sanitizedPayload)
          .eq('id', id)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message, success: false }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (table === 'client_address_history') {
          await logAddressSyncEvent(supabase, {
            clientId,
            entityId: result.id,
            entityTable: 'client_address_history',
            operation: 'update',
            portalUserId: session.client_portal_users.id,
            portalEmail: session.client_portal_users.email,
          });
        }

        return new Response(
          JSON.stringify({ success: true, data: result }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: 'Unknown operation', success: false }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Portal manage error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
