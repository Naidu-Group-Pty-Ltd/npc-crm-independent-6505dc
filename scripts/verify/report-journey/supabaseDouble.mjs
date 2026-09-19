/**
 * A stand-in for the Supabase project, answered from fixtures.
 *
 * The real Investment Compass journey — open the report, edit it, choose a
 * template, preview, generate the client PDF, send it — is driven in a REAL
 * browser against the REAL application. Every request the browser makes to
 * `*.supabase.co` is intercepted at the browser and answered from here, from
 * rows read out of production earlier. Nothing here holds or forges a
 * credential: the "session" is a fixture user the application is told about,
 * and every write the journey makes lands in this process's memory.
 *
 * That is what lets the check run with no login, no network and no side
 * effects, on every change.
 *
 * ## What is answered
 *
 *   custom-auth-verify-v2           a fixture superadmin session
 *   admin-user-management           get_my_permissions → every module
 *   mission-control-balance         a healthy balance (entitlements open)
 *   get-investment-reports          the fixture report (edits persist in memory)
 *   manage-investment-reports       update → merged into the in-memory row
 *   manage-templates                list/get templates, list/upsert/delete selections
 *   manage-global-report-settings   the deployment's settings row
 *   render-template-pdf             LOCAL WeasyPrint on the posted HTML
 *   secure-storage                  upload → remembered; download → served
 *   REST whitelabel_settings        the deployment's branding row
 *
 * And, for the format journeys (RS-5c.5), any table a record's fixture
 * directory carries under `tables/<table>.json`:
 *
 *   REST <table>                    PostgREST semantics: `eq.`/`in.` filters,
 *                                   order, limit, and a single object for
 *                                   `Accept: …vnd.pgrst.object+json`
 *   authenticated-data/<table>      the cookie gateway, same rows, same rules
 *   get-client-data (listMode)      `listOptions.table` + `filters`, answered
 *                                   under the table's name and `records`
 *   manage-ci-assessments           get → { assessment, latestRun }; list
 *
 * Anything else answers an empty success and is LOGGED, so the manifest at
 * the end says exactly what the page asked for that nobody supplied.
 */
import fs from 'node:fs';
import path from 'node:path';

export function loadFixtures(root, reportId, { requireReport = true } = {}) {
  const reportFile = path.join(root, reportId, 'report.json');
  const tablesDir = path.join(root, reportId, 'tables');
  if (!fs.existsSync(reportFile) && (requireReport || !fs.existsSync(tablesDir))) {
    throw new Error(`No fixture for report ${reportId} at ${reportFile}. See README.md to populate .verify/fixtures.`);
  }
  const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : null;
  // Rows for any other table the journey's page or adapter reads: one file per
  // table, an array of rows read out of production (RS-5c.5).
  const rows = {};
  if (fs.existsSync(tablesDir)) {
    for (const f of fs.readdirSync(tablesDir).filter((x) => x.endsWith('.json'))) {
      const parsed = JSON.parse(fs.readFileSync(path.join(tablesDir, f), 'utf8'));
      rows[f.replace(/\.json$/, '')] = Array.isArray(parsed) ? parsed : [parsed];
    }
  }
  const tplDir = path.join(root, 'templates');
  const templates = fs.readdirSync(tplDir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => JSON.parse(fs.readFileSync(path.join(tplDir, f), 'utf8')));
  const settings = JSON.parse(fs.readFileSync(path.join(root, 'global_report_settings.json'), 'utf8'));
  const whitelabel = JSON.parse(fs.readFileSync(path.join(root, 'whitelabel_settings.json'), 'utf8'));
  const assetsDir = path.join(root, 'assets');
  return { report, rows, templates, settings, whitelabel, assetsDir };
}

const FIXTURE_USER = {
  id: '00000000-0000-4000-8000-00000000c0de',
  username: 'verify.harness',
  role: 'super_admin',
};

/**
 * A token with a JWT's SHAPE and no signature worth anything: the app only
 * decodes it client-side to decide it is signed in with an RLS token (and
 * warns loudly when there is none), and every request it is attached to is
 * answered here. It authenticates nothing anywhere.
 */
/** One client to send the report to — a fixture, not a person. */
const FIXTURE_CLIENT = {
  id: '00000000-0000-4000-8000-0000000c11e7', primary_first_name: 'Verify', primary_surname: 'Client',
  primary_email: 'verify.client@example.invalid', pipeline_status: 'active',
};

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const FIXTURE_ACCESS_TOKEN = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
  sub: FIXTURE_USER.id, role: 'authenticated', aud: 'authenticated', iss: 'verify-harness',
  exp: Math.floor(Date.now() / 1000) + 6 * 3600,
})}.harness`;

/**
 * Columns `TEMPLATE_COLUMNS` asks for, plus the PostgREST alias
 * `libraryLineage:config->libraryLineage`.
 */
function projectTemplateForList(t) {
  return {
    id: t.id, name: t.name, description: t.description ?? null, report_type: t.report_type,
    engine: t.engine, is_active: t.is_active, is_default: t.is_default, is_draft: t.is_draft,
    scope: t.scope ?? null, variant: t.variant ?? null, tier: t.tier ?? null,
    priority: t.priority ?? 0, updated_at: t.updated_at, thumbnail_url: t.thumbnail_url ?? null,
    libraryLineage: t.config?.libraryLineage ?? null,
  };
}

/** `filters` are equality tests, the shape `get-client-data`'s list mode takes. */
function selectRows(rows, { filters, limit, orderBy, orderAsc } = {}) {
  let out = rows;
  for (const [k, v] of Object.entries(filters ?? {})) out = out.filter((r) => String(r[k]) === String(v));
  if (orderBy) {
    out = [...out].sort((a, b) => (String(a[orderBy]) < String(b[orderBy]) ? -1 : 1) * (orderAsc ? 1 : -1));
  }
  if (limit) out = out.slice(0, Number(limit));
  return out;
}

export function createSupabaseDouble(fixtures, opts = {}) {
  const log = [];
  /**
   * The row as the fixture holds it, kept apart so the journey can put a field
   * back after it has proved a write reached the broker.
   *
   * The edit-persistence step types a marker into the report content and asserts
   * it was stored — and the SAME run then finalises the document, so every
   * acceptance PDF this harness produced carried `[VERIFY-EDIT …]` in its prose.
   * Proving the edit path works and producing a clean document are two jobs, and
   * one run can do both only if the fixture is put back between them.
   */
  const pristine = structuredClone(fixtures.report ?? null);
  const state = {
    report: structuredClone(fixtures.report ?? null),
    selections: [],          // report_template_selections rows this run wrote
    uploads: new Map(),      // storage path → bytes
    renders: [],
    routeCalls: [],             // every render-template-pdf call, with its HTML
    portalReports: [],       // client_portal_reports rows the send flow wrote
    updates: [],             // every manage-investment-reports update payload
  };
  const renderHtml = opts.renderHtml; // async (html) => Uint8Array | null
  // A journey's own answers for functions its page calls that are not what
  // the journey is about (a marketing page's analytics panels, say). Answered
  // here so they count as fulfilled rather than as something nobody supplied.
  const extraEdge = opts.extraEdge ?? (() => null);

  const json = (body, status = 200) => ({
    status, contentType: 'application/json', body: JSON.stringify(body),
  });
  /** A one-page PDF (over 10 KB, so a download check sees a document) carrying one line of text. */
  const standInPdf = (text) => {
    const safe = String(text).replace(/[()\\]/g, ' ');
    const stream = `BT /F1 14 Tf 60 780 Td (${safe}) Tj ET`;
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let out = '%PDF-1.4\n%' + 'stand-in '.repeat(1400) + '\n';
    const offsets = [];
    objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  };

  async function edge(name, body) {
    switch (name) {
      case 'custom-auth-verify-v2':
        return json({ valid: true, user: FIXTURE_USER, roles: ['superadmin'], access_token: FIXTURE_ACCESS_TOKEN, jwt_unavailable: false });
      case 'custom-auth-logout-v2':
        return json({ success: true });
      case 'admin-user-management':
        if (body?.action === 'get_my_permissions') {
          const grant = (module_key) => ({ module_key, can_view: true, can_edit: true, can_delete: true });
          return json({ success: true, permissions: ['reports', 'generated_reports', 'report_qa', 'marketing', 'clients', 'dashboard'].map(grant) });
        }
        return json({ success: true });
      case 'mission-control-balance':
        return json({ available: 100000, allowance: 100000, used: 0, reserved: 0, planName: 'Verify', planSlug: 'scale' });
      case 'mission-control-gate':
        return json({ status: 'open' });
      case 'get-investment-reports': {
        if (body?.table === 'property_comparisons') {
          // `loadPropertyComparisonRow` reads one comparison by id through this
          // broker (the table's only SELECT policy is `user_id = auth.uid()`).
          const rows = fixtures.rows?.property_comparisons ?? [];
          if (body.reportId) {
            const row = rows.find((r) => r.id === body.reportId);
            return row ? json({ success: true, report: row }) : json({ success: false, error: 'not found' }, 404);
          }
          return json({ success: true, reports: rows, count: rows.length });
        }
        if (body?.reportId && body.reportId === state.report?.id) {
          return json({ success: true, report: state.report });
        }
        if (body?.familyOf) return json({ success: true, family: null });
        return json({ success: true, reports: [], count: 0 });
      }
      case 'manage-investment-reports': {
        if (body?.action === 'update' && body.reportId === state.report?.id) {
          state.updates.push(body.data);
          state.report = {
            ...state.report, ...body.data,
            updated_at: new Date().toISOString(),
            current_version: (state.report.current_version ?? 1),
          };
          return json({ success: true, report: state.report });
        }
        return json({ success: true });
      }
      case 'manage-templates': {
        const { operation, table, recordId, listOptions, data } = body ?? {};
        if (table === 'report_templates') {
          if (operation === 'list') {
            const sel = String(listOptions?.select ?? '');
            const rows = fixtures.templates.filter((t) => t.is_active);
            const records = sel.includes('previewPage')
              ? rows.map((t) => ({ id: t.id, previewPage: t.schema?.pages?.[0] ?? null, previewTokens: t.schema?.tokens ?? {} }))
              : rows.map(projectTemplateForList);
            return json({ success: true, records, count: records.length });
          }
          if (operation === 'get' && recordId) {
            const t = fixtures.templates.find((x) => x.id === recordId);
            return t ? json({ success: true, record: t }) : json({ success: false, error: 'not found' }, 404);
          }
        }
        if (table === 'report_template_selections') {
          if (operation === 'list') return json({ success: true, records: state.selections, count: state.selections.length });
          if (operation === 'upsert' && data) {
            const row = { id: `sel-${data.report_type}`, owner_user_id: FIXTURE_USER.id, ...data, updated_at: new Date().toISOString() };
            state.selections = state.selections.filter((s) => s.report_type !== data.report_type).concat(row);
            return json({ success: true, records: row });
          }
          if (operation === 'delete' && recordId) {
            state.selections = state.selections.filter((s) => s.id !== recordId);
            return json({ success: true });
          }
        }
        if (table === 'template_library_entries' && operation === 'list') return json({ success: true, records: [], count: 0 });
        if (table === 'property_comparisons' && operation === 'list') {
          const rows = selectRows(fixtures.rows?.property_comparisons ?? [], listOptions ?? {});
          return json({ success: true, records: rows, count: rows.length });
        }
        return json({ success: true, records: [], count: 0 });
      }
      case 'report-qa': {
        // The Report Q&A page: its saved conversations and one conversation's
        // messages, from `tables/report_qa_conversations.json` and
        // `tables/report_qa_messages.json`. Shapes are the function's own
        // (`get-conversations` → three lists; `load-conversation` → the row,
        // a page of messages, the total and `hasMore`).
        const convs = fixtures.rows?.report_qa_conversations ?? [];
        const msgs = fixtures.rows?.report_qa_messages ?? [];
        const action = body?.action;
        if (action === 'get-conversations') {
          const listed = convs.map((c) => ({
            id: c.id, title: c.title, report_names: c.report_names, created_at: c.created_at, updated_at: c.updated_at,
            structured_report: c.structured_report, client_id: c.client_id, agent_mode: c.agent_mode,
            branched_from_conversation_id: c.branched_from_conversation_id, branched_from_message_id: c.branched_from_message_id,
          }));
          return json({ success: true, conversations: listed, shared_conversations: [], legacy_conversations: [] });
        }
        if (action === 'load-conversation') {
          const conversation = convs.find((c) => c.id === body?.conversationId) ?? null;
          if (!conversation) return json({ success: false, error: 'not found' }, 404);
          const all = msgs.filter((m) => m.conversation_id === conversation.id)
            .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
          const offset = Number(body?.offset ?? 0) || 0;
          const limit = Number(body?.limit ?? 50) || 50;
          const pageRows = all.slice(offset, offset + limit);
          return json({ success: true, conversation, messages: pageRows, totalMessages: all.length, hasMore: offset + limit < all.length });
        }
        // Housekeeping the page does around a load (title touch, index refresh).
        return json({ success: true });
      }
      case 'manage-global-report-settings':
        return json(fixtures.settings);
      case 'render-template-pdf': {
        const html = String(body?.html ?? '');
        // The HTML is kept so a run can write it beside the PDF: a geometry
        // defect is diagnosed on the document the engine was handed, and the
        // journey is the only place that document exists.
        const entry = { mode: body?.mode, reportId: body?.reportId ?? null, templateId: body?.templateId ?? null, htmlBytes: html.length, html, at: Date.now() };
        state.renders.push(entry);
        if (!renderHtml) return json({ error: 'no local renderer configured' }, 500);
        const pdf = await renderHtml(html);
        if (!pdf) return json({ error: 'local WeasyPrint failed' }, 500);
        const storagePath = `template-builder/${new Date().toISOString().slice(0, 10)}/${entry.at}-${String(body?.fileName || 'report.pdf')}`;
        state.uploads.set(storagePath, pdf);
        entry.path = storagePath; entry.bytes = pdf.length;
        const url = `data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}`;
        return json({ url, path: storagePath, fileName: body?.fileName, mode: body?.mode, templateId: body?.templateId ?? null, bytes: pdf.length, jobId: `job-${entry.at}` });
      }
      case 'secure-storage': {
        if (body?.action === 'upload' || body?.operation === 'upload') {
          const p = String(body.path ?? body.filePath ?? `upload-${Date.now()}`);
          state.uploads.set(p, Buffer.from(String(body.data ?? body.fileData ?? ''), 'base64'));
          return json({ success: true, data: { path: p, publicUrl: '' } });
        }
        return json({ success: true, data: { publicUrl: '' } });
      }
      case 'render-report-qa-pdf': {
        // The format's own route. Its document is drawn by the deployed
        // function against the Cloud Run engine and is not reproducible here;
        // the journey watches that the front end ASKED it (and not a template),
        // so it is answered with a stand-in PDF the download path can save.
        const stub = standInPdf(`Report Q&A — ${String(body?.subject ?? 'transcript')} — stand-in`);
        state.routeCalls.push({ fn: name, subject: body?.subject ?? null, conversationId: body?.conversationId ?? null });
        return json({
          url: `data:application/pdf;base64,${stub.toString('base64')}`,
          fileName: `Q_and_A-${String(body?.subject ?? 'transcript')}.pdf`,
          pageCount: 1, brandGaps: [], sections: [], subject: body?.subject ?? 'transcript',
          turnCount: 0, turnsShown: 0, truncated: false, generated: false, attachment: null,
        });
      }
      case 'get-user-names':
        // The library resolves author names for its cards; none is a fixture user.
        return json({ success: true, users: [] });
      case 'log-activity':
      case 'activity-logger':
      case 'log-report-render-event':
        return json({ success: true });
      case 'notifications-feed-v2':
        return json({ success: true, notifications: [] });
      case 'internal-messaging':
        return json({ success: true, threads: [], messages: [], unread: 0 });
      case 'mission-control-plan-change':
        return json({ changes: [] });
      case 'mission-control-feedback-prompt':
        return json({ due: false });
      // Platform notices, mounted by `DashboardLayout` on every dashboard page
      // and therefore on every report page too. An empty channel is the shape
      // `parseAnnouncementsPayload` reads and is what a deployment with
      // nothing published answers; the host then draws nothing.
      case 'mission-control-announcements':
        return json({ announcements: [] });
      case 'manage-template-library':
        return json({ success: true, records: [], count: 0 });
      case 'authenticated-data':
        return json({ success: true, data: [], records: [] });
      case 'get-client-data': {
        // List mode names a table: a client-scoped row the adapters read
        // through this broker (borrowing capacity, portfolio, the client's
        // children). Without a table it is the send dialog's client list.
        const table = body?.listMode ? body?.listOptions?.table : null;
        if (table) {
          const rows = selectRows(fixtures.rows?.[table] ?? [], body.listOptions ?? {});
          return json({ success: true, [table]: rows, records: rows, count: rows.length });
        }
        return json({ success: true, clients: fixtures.rows?.clients ?? [FIXTURE_CLIENT] });
      }
      case 'manage-ci-assessments': {
        const assessments = fixtures.rows?.commercial_industrial_assessments ?? [];
        const runs = fixtures.rows?.commercial_industrial_calculation_runs ?? [];
        if (body?.operation === 'get') {
          const assessment = assessments.find((a) => a.id === body.assessmentId) ?? null;
          if (!assessment) return json({ success: false, error: 'not found' }, 404);
          const latestRun = runs.filter((r) => r.assessment_id === assessment.id)
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;
          return json({ success: true, data: { assessment, latestRun } });
        }
        if (body?.operation === 'list') return json({ success: true, data: assessments });
        return json({ success: true, data: null });
      }
      case 'manage-client-data': {
        if (body?.operation === 'create' && body?.table === 'client_portal_reports') {
          const row = { id: `portal-${Date.now()}`, ...(body.data ?? {}) };
          state.portalReports.push(row);
          return json({ success: true, data: row, record: row });
        }
        return json({ success: true, data: null });
      }
      default: {
        const extra = extraEdge(name, body);
        return extra ? json(extra) : null; // unfulfilled → logged
      }
    }
  }

  async function rest(table, method, url = null, headers = {}) {
    if (table === 'whitelabel_settings') return json([fixtures.whitelabel]);
    if (table === 'feature_flags') return json([]);
    // The deployment's settings, as rows: `organisationProjection` reads the
    // table through the gateway, where the Investment page asked the broker.
    if (table === 'global_report_settings' && Array.isArray(fixtures.settings)) return json(fixtures.settings);
    if (!['GET', 'HEAD'].includes(method) || !url) return null;
    // A table with no fixture rows is a table with no rows: PostgREST answers
    // an empty array, and so does this — the generic gateway answer it
    // replaced (RS-5c.5) had always done the same. A page reading a table the
    // fixture set does not carry (`report_structure_templates` on the
    // Investment page) is not a page nothing answered.
    const rows = fixtures.rows?.[table] ?? [];
    // PostgREST, as far as a read of fixture rows needs it.
    let out = rows;
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      const m = /^(eq|in)\.(.*)$/.exec(v);
      if (!m) continue;
      if (m[1] === 'eq') out = out.filter((r) => String(r[k]) === m[2]);
      else {
        const set = m[2].replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
        out = out.filter((r) => set.includes(String(r[k])));
      }
    }
    const order = url.searchParams.get('order');
    if (order) {
      const [col, dir] = order.split('.');
      out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === 'desc' ? -1 : 1));
    }
    const limit = Number(url.searchParams.get('limit'));
    if (limit) out = out.slice(0, limit);
    // `.select('id', { count: 'exact', head: true })` is a HEAD with
    // `Prefer: count=exact`; the answer is the count in Content-Range alone.
    if (method === 'HEAD') {
      return { status: 200, contentType: 'application/json', body: '', headers: { 'content-range': `0-${Math.max(0, out.length - 1)}/${out.length}` } };
    }
    if (String(headers['accept'] ?? '').includes('vnd.pgrst.object')) {
      // `.maybeSingle()` reads PGRST116 as "no row" rather than as an error.
      return out.length === 1
        ? json(out[0])
        : json({ code: 'PGRST116', details: `${out.length} rows`, message: 'JSON object requested, multiple (or no) rows returned' }, 406);
    }
    return json(out);
  }

  /** Playwright route handler. */
  async function handle(route, request) {
    const url = new URL(request.url());
    if (process.env.VERIFY_TRACE) console.log(`[route] ${request.method()} ${url.host}${url.pathname.slice(0, 80)}`);
    const method = request.method();
    // The app sends `credentials: 'include'`, and a credentialed request is
    // refused by the browser unless the answer names the exact origin and says
    // credentials are allowed — a `*` here makes every call throw and the app
    // reads that as "session unverifiable" and shows the sign-in form.
    const origin = request.headers()['origin'] ?? 'http://127.0.0.1:5173';
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-expose-headers': 'x-correlation-id, content-range',
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const host = url.hostname;
    let answer = null; let kind = 'external';
    if (host.endsWith('.supabase.co')) {
      const fn = url.pathname.match(/\/functions\/v1\/([^/]+)/)?.[1];
      const table = url.pathname.match(/\/rest\/v1\/([^/?]+)/)?.[1];
      let body = null;
      if (fn) { try { body = request.postDataJSON(); } catch { body = null; } }
      if (fn === 'authenticated-data') {
        // The cookie gateway is PostgREST with a different prefix.
        const gwTable = (url.pathname.split('/functions/v1/authenticated-data/')[1] ?? '').split('/')[0];
        kind = `gw:${gwTable}`; answer = await rest(gwTable, method, url, request.headers());
      }
      else if (fn) { kind = `fn:${fn}`; answer = await edge(fn, body); }
      else if (table) { kind = `rest:${table}`; answer = await rest(table, method, url, request.headers()); }
      else if (url.pathname.includes('/storage/v1/object/')) {
        kind = 'storage';
        const p = decodeURIComponent(url.pathname.split('/object/')[1] ?? '');
        for (const [k, v] of state.uploads) if (p.endsWith(k)) { answer = { status: 200, contentType: 'application/pdf', body: Buffer.from(v) }; break; }
        if (!answer && fixtures.assetsDir) {
          const which = p.includes('615db046') ? 'reportMono.png' : 'report.png';
          const f = path.join(fixtures.assetsDir, which);
          if (fs.existsSync(f)) answer = { status: 200, contentType: 'image/png', body: fs.readFileSync(f) };
        }
      }
      else if (url.pathname.includes('/realtime/')) { kind = 'realtime'; answer = { status: 204, body: '' }; }
    } else if (host === 'challenges.cloudflare.com') {
      kind = 'turnstile'; answer = { status: 204, body: '' };
    } else if (host === '127.0.0.1' || host === 'localhost') {
      return route.continue();
    }
    log.push({ kind, method, url: url.pathname.slice(0, 120), fulfilled: !!answer });
    if (!answer) {
      // Unknown: answer an empty success so the page does not hang, and record it.
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}', headers: cors });
    }
    return route.fulfill({ status: answer.status, contentType: answer.contentType, body: answer.body, headers: { ...cors, ...(answer.headers ?? {}) } });
  }

  /**
   * Put named fields of the report row back to the fixture's own values.
   *
   * Deliberately narrow: it restores from the pristine clone and never invents
   * a value, so a field the fixture does not carry is deleted rather than
   * defaulted, and nothing else the run wrote is touched. It is a fixture
   * reset, not a content scrubber — it cannot remove a real user's edit,
   * because it only ever writes what the fixture already said.
   */
  function restoreReportFields(fields) {
    if (!state.report || !pristine) return [];
    const restored = [];
    for (const key of fields) {
      const before = state.report[key];
      if (key in pristine) state.report[key] = structuredClone(pristine[key]);
      else delete state.report[key];
      if (before !== state.report[key]) restored.push(key);
    }
    return restored;
  }

  return { handle, state, log, restoreReportFields };
}
