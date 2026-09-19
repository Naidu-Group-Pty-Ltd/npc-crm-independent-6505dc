import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders } from "../_shared/auth.ts"
import { governedAuthorityBlockFromFlags } from "../_shared/reports/contract/governedNarrativeAuthority.pure.ts"

function extractPortalToken(headers: Headers, body?: any): string | null {
  const headerToken = headers.get('x-portal-session-token');
  if (headerToken) return headerToken;
  if (body?.portal_session_token) return body.portal_session_token;
  const sessionHeader = headers.get('x-session-token');
  if (sessionHeader) return sessionHeader;
  if (body?.session_token) return body.session_token;
  return null;
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

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      console.error('[get-portal-client-data] Failed to parse request body');
      return new Response(
        JSON.stringify({ error: 'Invalid request body', success: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sessionToken = extractPortalToken(req.headers, body);
    console.log('[get-portal-client-data] Session token present:', !!sessionToken);

    if (!sessionToken) {
      return new Response(
        JSON.stringify({ error: 'Authentication required', success: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate session and get client_id
    const { data: session, error: sessionError } = await supabase
      .from('client_portal_sessions')
      .select(`
        *,
        client_portal_users:user_id (
          id, client_id, email, status
        )
      `)
      .eq('session_token', sessionToken)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    console.log('[get-portal-client-data] Session query result:', {
      hasSession: !!session,
      sessionError: sessionError?.message || null,
      hasPortalUser: !!session?.client_portal_users,
      portalUserStatus: session?.client_portal_users?.status,
    });

    if (sessionError || !session?.client_portal_users || session.client_portal_users.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session', success: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const clientId = session.client_portal_users.client_id;

    // Handle client-files download (STOR-004): return a short-lived SIGNED URL
    // scoped to a file that belongs to THIS portal user's client, so the
    // client-files bucket can be private (no anonymous download path).
    if (body.action === 'downloadFile') {
      const fileId = body.fileId;
      if (!fileId) {
        return new Response(JSON.stringify({ error: 'fileId is required', success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const { data: fileRow } = await supabase
        .from('client_files')
        .select('id, client_id, file_path, file_name')
        .eq('id', fileId)
        .maybeSingle();
      // Ownership: the file must belong to the caller's client. 404 (not 403)
      // avoids confirming existence of other clients' files.
      if (!fileRow || fileRow.client_id !== clientId || !fileRow.file_path) {
        return new Response(JSON.stringify({ error: 'Not found', success: false }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const { data: signed } = await supabase.storage.from('client-files').createSignedUrl(fileRow.file_path, 300);
      if (!signed?.signedUrl) {
        return new Response(JSON.stringify({ error: 'Failed to generate download link', success: false }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true, signedUrl: signed.signedUrl, fileName: fileRow.file_name }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Handle report download action
    if (body.action === 'downloadReport') {
      const reportId = body.reportId;
      if (!reportId) {
        return new Response(
          JSON.stringify({ error: 'reportId is required', success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Verify the report belongs to this client
      const { data: report, error: reportError } = await supabase
        .from('client_portal_reports')
        .select('id, storage_path, report_title, source_report_id')
        .eq('id', reportId)
        .eq('client_id', clientId)
        .maybeSingle();

      if (reportError || !report) {
        return new Response(
          JSON.stringify({ error: 'Report not found', success: false }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // RF-7.2B.1A — a governed-authority block must survive a PDF that was
      // rendered BEFORE the block existed.
      //
      // Two ways a stale document could otherwise reach a client here: the
      // source report's `pdf_url`, and `client_portal_reports.storage_path`,
      // which this function CACHES from it a few lines below — after which the
      // investment report is never consulted again. So the source report's
      // verdict is read whenever there is a source report at all, cached path
      // or not. Refusing the render alone would have left both copies live.
      if (report.source_report_id) {
        const { data: sourceFlags } = await supabase
          .from('investment_reports')
          .select('validation_flags')
          .eq('id', report.source_report_id)
          .maybeSingle();
        const block = governedAuthorityBlockFromFlags(sourceFlags?.validation_flags);
        if (block.blocked) {
          console.error(
            `⛔ [get-portal-client-data] withheld ${report.source_report_id}: governed-authority `
            + `block (${block.categories.join(', ')})`,
          );
          return new Response(
            JSON.stringify({
              error: 'report_not_client_ready',
              reason: 'governed_authority_block',
              success: false,
            }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
      }

      let storagePath = report.storage_path;

      // If no storage_path, try to look up the source investment report's pdf_url
      if (!storagePath && report.source_report_id) {
        const { data: sourceReport } = await supabase
          .from('investment_reports')
          .select('pdf_url')
          .eq('id', report.source_report_id)
          .maybeSingle();
        if (sourceReport?.pdf_url) {
          storagePath = sourceReport.pdf_url;
          // Also update the portal report record so future downloads are faster
          await supabase
            .from('client_portal_reports')
            .update({ storage_path: sourceReport.pdf_url })
            .eq('id', reportId);
        }
      }

      if (!storagePath) {
        return new Response(
          JSON.stringify({ error: 'No file available for this report', success: false }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // storagePath is now resolved above

      // If storage_path is a full URL: for a legacy Supabase PUBLIC URL, convert
      // it to a short-lived SIGNED URL so it keeps working once the bucket is
      // private (STOR-004). Non-Supabase external URLs are returned as-is.
      if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) {
        await supabase.from('client_portal_reports').update({ is_read: true }).eq('id', reportId);

        // .../storage/v1/object/public/<bucket>/<path>  ->  { bucket, path }
        const m = storagePath.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
        let outUrl = storagePath;
        if (m) {
          const [, legacyBucket, legacyPath] = m;
          const { data: reSigned } = await supabase.storage.from(legacyBucket).createSignedUrl(decodeURIComponent(legacyPath), 300);
          if (reSigned?.signedUrl) outUrl = reSigned.signedUrl;
        }
        console.log('[get-portal-client-data] Returning URL for report:', report.report_title);
        return new Response(
          JSON.stringify({ success: true, signedUrl: outUrl, reportTitle: report.report_title }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Try client-files bucket first, then investment-reports bucket
      let signedUrl: string | null = null;
      
      const { data: signedUrlData, error: signedUrlError } = await supabase
        .storage
        .from('client-files')
        .createSignedUrl(storagePath, 300);

      if (signedUrlData?.signedUrl) {
        signedUrl = signedUrlData.signedUrl;
      } else {
        // Fallback to investment-reports bucket
        const { data: fallbackData } = await supabase
          .storage
          .from('investment-reports')
          .createSignedUrl(storagePath, 300);
        if (fallbackData?.signedUrl) {
          signedUrl = fallbackData.signedUrl;
        }
      }

      if (!signedUrl) {
        console.error('[get-portal-client-data] Signed URL error:', signedUrlError?.message);
        return new Response(
          JSON.stringify({ error: 'Failed to generate download link', success: false }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Mark as read
      await supabase
        .from('client_portal_reports')
        .update({ is_read: true })
        .eq('id', reportId);

      console.log('[get-portal-client-data] Generated signed URL for report:', report.report_title);

      return new Response(
        JSON.stringify({ success: true, signedUrl, reportTitle: report.report_title }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const include = body.include || {};
    console.log('[get-portal-client-data] Fetching data for clientId:', clientId, 'include:', JSON.stringify(include));

    const result: Record<string, any> = { success: true, clientId };

    // Fetch client profile
    if (include.client !== false) {
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();
      
      if (clientError) {
        console.error('[get-portal-client-data] Client fetch error:', clientError.message);
      }
      result.client = client;
    }

    // Fetch properties
    if (include.properties !== false) {
      const { data: properties, error: propError } = await supabase
        .from('client_properties')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      if (propError) console.error('[get-portal-client-data] Properties error:', propError.message);
      result.properties = properties || [];
    }

    // Fetch employment
    if (include.employment) {
      const { data: employment } = await supabase
        .from('client_employment')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      result.employment = employment || [];
    }

    // Fetch address history
    if (include.addressHistory || include.employment) {
      const { data: addressHistory } = await supabase
        .from('client_address_history')
        .select('*')
        .eq('client_id', clientId)
        .order('is_current', { ascending: false })
        .order('start_date', { ascending: false });
      result.addressHistory = addressHistory || [];
    }

    // Fetch income sources
    if (include.income) {
      const { data: income } = await supabase
        .from('client_income_sources')
        .select('*')
        .eq('client_id', clientId)
        .order('display_order', { ascending: true });
      result.income = income || [];
    }

    // Fetch expenses
    if (include.expenses) {
      const { data: expenses } = await supabase
        .from('client_expenses')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      result.expenses = expenses || [];
    }

    // Fetch assets
    if (include.assets) {
      const { data: assets } = await supabase
        .from('client_assets')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      result.assets = assets || [];
    }

    // Fetch liabilities
    if (include.liabilities) {
      const { data: liabilities } = await supabase
        .from('client_liabilities')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      result.liabilities = liabilities || [];
    }

    // Fetch deals with stages and build progress payments
    if (include.deals) {
      // Client-safe projection only. `select('*')` shipped commission
      // estimates, clawback terms, risk status and internal notes to the
      // client's browser — fields no portal surface renders and no client
      // should receive. What the client may read is decided here, at the
      // projection, not by which fields the page happens to display.
      const { data: deals } = await supabase
        .from('client_deals')
        .select('id, deal_type, property_address, current_stage, current_stage_number, total_contract_price, land_price, build_price, loan_amount, existing_loan_amount, new_loan_amount, equity_released, finance_clause_expiry, settlement_date, land_settlement_date, expected_build_start, estimated_completion, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

      const dealsList = deals || [];

      // Fetch stages and build payments for each deal
      if (dealsList.length > 0) {
        const dealIds = dealsList.map((d: any) => d.id);

        const [stagesResult, buildPaymentsResult] = await Promise.all([
          supabase
            .from('deal_stages')
            // client_action is the one field written in the client's own
            // language ("Sign contract", "Pay 5%") — it is what the portal
            // shows as "what we need from you". Internal actions, the
            // responsible role and key dates stay staff-side.
            .select('id, deal_id, stage_number, stage_name, stage_category, status, client_action, completed_at, display_order')
            .in('deal_id', dealIds)
            .order('display_order', { ascending: true }),
          supabase
            .from('build_progress_payments')
            .select('id, deal_id, stage_number, stage_name, percentage, amount, paid_to_builder, paid_to_builder_date, display_order')
            .in('deal_id', dealIds)
            .order('display_order', { ascending: true }),
        ]);

        const stagesByDeal: Record<string, any[]> = {};
        for (const s of (stagesResult.data || [])) {
          if (!stagesByDeal[s.deal_id]) stagesByDeal[s.deal_id] = [];
          stagesByDeal[s.deal_id].push(s);
        }

        const buildByDeal: Record<string, any[]> = {};
        for (const b of (buildPaymentsResult.data || [])) {
          if (!buildByDeal[b.deal_id]) buildByDeal[b.deal_id] = [];
          buildByDeal[b.deal_id].push(b);
        }

        for (const deal of dealsList) {
          (deal as any).stages = stagesByDeal[deal.id] || [];
          (deal as any).buildPayments = buildByDeal[deal.id] || [];
        }
      }

      result.deals = dealsList;
    }

    // Fetch emails (read-only)
    if (include.emails) {
      const { data: emails } = await supabase
        .from('email_copilot_emails')
        .select('id, subject, sender, to_recipients, received_at, folder, status, urgency_level')
        .eq('client_id', clientId)
        .order('received_at', { ascending: false })
        .limit(100);
      result.emails = emails || [];
    }

    // Fetch files/documents
    if (include.files) {
      const { data: files } = await supabase
        .from('client_files')
        .select('id, file_name, file_path, file_type, file_size, category, document_type, description, uploaded_at, source_surface, source_actor_name, sync_status, last_sync_error, version_number, dedupe_key')
        .eq('client_id', clientId)
        .order('uploaded_at', { ascending: false });
      result.files = files || [];
    }

    // Fetch borrowing capacity
    if (include.borrowingCapacity) {
      const { data: bc } = await supabase
        .from('borrowing_capacity_assessments')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      result.borrowingCapacity = bc;
    }

    // Fetch notifications
    if (include.notifications) {
      const { data: notifications } = await supabase
        .from('client_portal_notifications')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(50);
      result.notifications = notifications || [];
    }

    // Fetch messages
    if (include.messages) {
      const { data: messages } = await supabase
        .from('client_portal_messages')
        .select('*')
        .eq('client_id', clientId)
        .eq('is_internal', false) // never expose staff-only internal messages to the client
        .order('created_at', { ascending: true })
        .limit(200);
      result.messages = messages || [];
    }

    // Fetch published reports
    if (include.reports) {
      const { data: reports } = await supabase
        .from('client_portal_reports')
        .select('*')
        .eq('client_id', clientId)
        .order('published_at', { ascending: false })
        .limit(100);
      result.reports = reports || [];
    }

    // Fetch report requests
    if (include.reportRequests) {
      const { data: reportRequests } = await supabase
        .from('client_portal_report_requests')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(50);
      result.reportRequests = reportRequests || [];
    }

    // Fetch lender submissions (read-only, with limited fields)
    if (include.lenderSubmissions) {
      const { data: subs } = await supabase
        .from('lender_submissions')
        .select('id, lender_name, product_name, loan_amount, interest_rate, comparison_rate, loan_purpose, repayment_type, status, submitted_at, approved_at, settled_at, created_at, updated_at')
        .eq('client_id', clientId)
        .order('updated_at', { ascending: false });
      result.lenderSubmissions = subs || [];
    }

    // Fetch comparison sheets shared with the client
    if (include.lenderComparisons) {
      const { data: sheets } = await supabase
        .from('lender_comparison_sheets')
        .select('id, name, lender_ids, rate_snapshot, notes, created_at')
        .eq('client_id', clientId)
        .eq('shared_with_client', true)
        .order('created_at', { ascending: false });
      result.lenderComparisons = sheets || [];
    }

    console.log('[get-portal-client-data] Success. Keys returned:', Object.keys(result));

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[get-portal-client-data] Unhandled error:', error?.message || error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});