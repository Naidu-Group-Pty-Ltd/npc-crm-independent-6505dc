/**
 * generate-brand-design-system
 *
 * Brand design systems: audited, drafted by Claude, saved.
 *
 * ## What a design system is here
 *
 * A name, a brand colour and a full `ReportDesignOptions`. That is the entire
 * surface, deliberately — it is exactly the surface the report design system
 * already reads, so a saved system is a *position* on the existing rendering
 * path rather than a new one. Every migrated format picks it up for free.
 *
 * ## The audit is a gate, not a warning
 *
 * A model asked for "warm sandstone" returns `#D8C9A8`, which is a pleasant
 * colour and 1.6:1 on ivory paper — an eyebrow nobody can read.
 * `resolveReportPalette` already corrects the two accent roles against the
 * worst ground each prints on, and `auditPaletteContrast` then checks every ink
 * role against every ground. A system that still fails is refused, with the
 * failing role, its ratio and its floor named.
 *
 * That refusal applies to a person's own hex as much as to the model's. There
 * is one reader and one audit, and which end the value came from is not one of
 * their inputs.
 *
 * ## `generate` does not save
 *
 * A model's first answer is a proposal. Saving every attempt at a brief would
 * fill the picker — a list somebody chooses a house style from — with drafting.
 * The browser holds the draft and calls `save` when a person accepts it.
 *
 * ## The palette is never a column
 *
 * `brand_design_systems` stores the brand hex and the options. The palette is
 * resolved at render time, every time, because a palette derived under one
 * preset's paper grounds is not legal under another's — a bug this repo has
 * already shipped once and records in `brandResolve.pure.ts`.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyAuthOrNativeUser } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { withRequestOrigin } from '../_shared/corsOrigin.ts';
import { importDesignSystem } from '../_shared/brandDesign/import.pure.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  auditBrandDesignSystem,
  BRAND_SYSTEM_JSON_SCHEMA,
  type BrandDesignSystem,
  brandSystemPrompt,
  describeAuditProblems,
  readBrandDesignSystem,
  slugify,
} from '../_shared/brandDesign/system.pure.ts';
import {
  type BrandListResponse,
  type BrandRouteResponse,
  extractJsonObject,
  parseBrandRequest,
  readBrandSystemSummary,
} from '../_shared/brandDesign/route.pure.ts';
import {
  ANTHROPIC_MESSAGES_URL,
  type AnthropicCredential,
  anthropicJsonHeaders,
} from '../_shared/anthropicRoute.pure.ts';
import { resolveAnthropicCredential } from '../_shared/anthropicCredential.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-portal-session-token, x-finance-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const MODEL = 'claude-opus-4-8';
const MODEL_TIMEOUT_MS = 90_000;

/**
 * Ask Claude for a design system.
 *
 * The schema and the prompt both come from `system.pure.ts`, beside the reader
 * that validates the answer — so the shape asked for and the shape accepted
 * cannot drift apart, which is the failure mode of every "the model returns
 * JSON" integration that keeps its prompt in the route.
 */
async function draftSystem(
  credential: AnthropicCredential,
  brief: string,
  companyName: string,
): Promise<{ ok: true; raw: unknown } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: anthropicJsonHeaders(credential),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1_500,
        // A tool call rather than "please return JSON". The schema is enforced
        // by the API, so a missing brace is not a class of failure that reaches
        // the reader at all.
        tools: [{
          name: 'design_system',
          description: 'The design system you have chosen.',
          input_schema: BRAND_SYSTEM_JSON_SCHEMA,
        }],
        tool_choice: { type: 'tool', name: 'design_system' },
        messages: [{ role: 'user', content: brandSystemPrompt(brief, companyName) }],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    return { ok: false, error: `the design service did not answer: ${String(e)}` };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, error: `the design service refused (${response.status}): ${detail.slice(0, 300)}` };
  }

  const message = await response.json().catch(() => null) as
    | { content?: Array<{ type?: string; name?: string; input?: unknown; text?: string }> }
    | null;
  const blocks = Array.isArray(message?.content) ? message!.content : [];

  const tool = blocks.find((b) => b?.type === 'tool_use' && b?.name === 'design_system');
  if (tool?.input && typeof tool.input === 'object') return { ok: true, raw: tool.input };

  // Belt and braces. `tool_choice` makes a text answer very unlikely, and a
  // feature that fails outright on the unlikely path is a feature that fails in
  // production on a Friday.
  const text = blocks.filter((b) => b?.type === 'text').map((b) => b?.text ?? '').join('\n');
  const parsed = extractJsonObject(text);
  if (parsed) return { ok: true, raw: parsed };

  return { ok: false, error: 'the design service returned no design system' };
}

/** The audit block every action answers with. */
function auditBlock(system: BrandDesignSystem): BrandRouteResponse['audit'] {
  const audit = auditBrandDesignSystem(system);
  return {
    ok: audit.ok,
    problems: audit.problems,
    summary: describeAuditProblems(audit.problems),
    accentOnPaper: audit.palette.accentOnPaper,
    accentOnField: audit.palette.accentOnField,
    paper: audit.palette.paper,
    field: audit.palette.field,
  };
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // SEC5-CSRF: reject cross-site cookie-authenticated invocations.
  //
  // This function authenticates through `verifyAuthOrNativeUser`, which reads
  // the `__Host-session_token` cookie and nothing else — and that cookie is
  // issued `SameSite=None`, so a page on any origin can make the browser send
  // it. `_shared/auth.ts` states the rule: a function that accepts the cookie
  // MUST also run `enforceCsrf`. Twelve did not, because
  // `check-csrf-coverage.mjs` tested `/\bverifyAuth\b/`, which cannot match
  // `verifyAuthOrNativeUser` — so the gate reported full coverage while
  // reporting on none of them. No-cookie and GET/HEAD/OPTIONS callers pass
  // through untouched.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const started = Date.now();

  try {
    const body = await req.json().catch(() => null);

    const auth = await verifyAuthOrNativeUser(
      supabase,
      req,
      body as { session_token?: string; command_centre_session_token?: string },
    );
    if (auth.error || !auth.userId || auth.userId === 'service_role') {
      return json({ error: auth.error || 'Authentication required' }, 401);
    }

    const parsed = parseBrandRequest(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const request = parsed.request;

    // A design system decides what every generated document looks like, so
    // creating one is an edit even though nothing client-facing changes. The
    // module is the one the Template Builder page is already guarded by.
    //
    // Reading the list is not. That split was flagged as the line to change if
    // a read-only surface ever needed the picker, and one does now: the
    // brand-systems page shows which system a document was set in, and somebody
    // who can view a report should be able to see that without being able to
    // rewrite the house style.
    const needed = request.action === 'list' ? 'can_view' : 'can_edit';
    const permission = await requireModulePermission(
      supabase,
      { userId: auth.userId, authMethod: auth.authMethod },
      'templates',
      needed,
    );
    if (!permission.ok) {
      return json({
        error: permission.error
          || `Templates ${needed === 'can_view' ? 'view' : 'edit'} permission required`,
      }, 403);
    }

    // ── list ────────────────────────────────────────────────────────────────
    //
    // The only way the picker can be populated. See the note on
    // `BrandListRequest`: the browser client is anonymous, so a direct read of
    // this table is refused at the grant level and the picker silently empties.

    if (request.action === 'list') {
      let query = supabase
        .from('brand_design_systems')
        // `neutrals` and `options` come back with the summary so the
        // brand-systems page can render a live specimen of any system in the
        // list without a second round trip per selection.
        .select(
          'id, name, slug, description, origin, brand_hex, is_active, updated_at, '
          + 'neutrals, source_namespace, options',
        )
        .order('updated_at', { ascending: false })
        .limit(100);
      if (!request.includeInactive) query = query.eq('is_active', true);

      const { data, error } = await query;
      // Thrown rather than answered with an empty list. A caller that cannot
      // tell "no design systems exist" from "the read failed" will show the
      // first and mean the second, which is the bug this action exists to fix.
      if (error) throw new Error(`could not list design systems: ${error.message}`);

      const response: BrandListResponse = {
        action: 'list',
        systems: ((data ?? []) as Record<string, unknown>[]).map(readBrandSystemSummary),
        durationMs: Date.now() - started,
      };
      return json(response);
    }

    // ── audit ───────────────────────────────────────────────────────────────

    if (request.action === 'audit') {
      const response: BrandRouteResponse = {
        action: 'audit',
        system: request.system,
        audit: auditBlock(request.system),
        id: null,
        slug: request.system.slug,
        brief: request.system.brief,
        durationMs: Date.now() - started,
      };
      return json(response);
    }

    // ── import ──────────────────────────────────────────────────────────────
    //
    // A design system published on claude.ai/design, read into a candidate.
    //
    // No model, no network and no write. `import.pure.ts` runs the derivation
    // `reportDesign/tokens.pure.ts` documents — paper is `--background`, the
    // cover ground is `--aurixa-obsidian`, and so on — over somebody else's
    // tokens instead of ours.
    //
    // The result goes through `readBrandDesignSystem` before it is audited, so
    // a value the import produced and a value a person typed reach the palette
    // through identical validation. There is one definition of a legal design
    // system and this is not a second one.

    if (request.action === 'import') {
      const imported = importDesignSystem(request.source, { name: request.name });
      if (!imported.ok) return json({ error: imported.error }, 400);

      const provenance = {
        namespace: imported.result.summary.namespace,
        tokenCount: imported.result.summary.tokenCount,
        colorCount: imported.result.summary.colorCount,
        cardCount: imported.result.summary.cardCount,
        themes: imported.result.summary.themes,
        brandFonts: imported.result.summary.brandFonts,
        sources: imported.result.sources as Record<string, string>,
        notes: imported.result.notes,
        kind: imported.result.summary.kind,
      };

      const read = readBrandDesignSystem(imported.result.system);
      if (!read.ok) return json({ error: `the imported system was not usable: ${read.error}` }, 422);

      const audit = auditBlock(read.system);
      if (!audit.ok) {
        // Refused, naming the role and the ground. An imported stock that
        // cannot carry its own body ink is a real defect in that design
        // system, and nudging the values until they pass would hand somebody a
        // document in colours nobody chose under a name saying otherwise.
        return json({
          error: `this design system cannot be made legible in print: ${audit.summary}`,
          audit,
          system: read.system,
          imported: provenance,
        }, 422);
      }

      const response: BrandRouteResponse = {
        action: 'import',
        system: read.system,
        audit,
        id: null,
        slug: read.system.slug,
        brief: '',
        imported: provenance,
        durationMs: Date.now() - started,
      };
      return json(response);
    }

    // ── generate ────────────────────────────────────────────────────────────

    if (request.action === 'generate') {
      const resolved = await resolveAnthropicCredential();
      if (!resolved.ok) {
        return json({ error: `the design service is not configured: ${resolved.why}` }, 503);
      }

      const drafted = await draftSystem(resolved.credential, request.brief, request.companyName);
      if (!drafted.ok) return json({ error: drafted.error }, 502);

      // The model's answer goes through the same reader as a form submission.
      // A refusal here is the model having invented something illegal, which is
      // worth saying plainly rather than papering over with defaults.
      const read = readBrandDesignSystem({
        ...(drafted.raw as Record<string, unknown>),
        origin: 'generated',
        brief: request.brief,
      });
      if (!read.ok) return json({ error: `the drafted system was not usable: ${read.error}` }, 502);

      const audit = auditBlock(read.system);
      if (!audit.ok) {
        // Refused rather than corrected. Silently nudging the hue until it
        // passes hands somebody a colour nobody chose, under a name that says
        // it was designed for them.
        return json({
          error: `the drafted system is not legible: ${audit.summary}`,
          audit,
          system: read.system,
        }, 422);
      }

      const response: BrandRouteResponse = {
        action: 'generate',
        system: read.system,
        audit,
        id: null,
        slug: read.system.slug,
        brief: request.brief,
        durationMs: Date.now() - started,
      };
      return json(response);
    }

    // ── save ────────────────────────────────────────────────────────────────

    const audit = auditBlock(request.system);
    if (!audit.ok) {
      return json({ error: `this design system is not legible: ${audit.summary}`, audit }, 422);
    }

    // The slug is unique, and a person naming a second system "Editorial" should
    // get "editorial-2" rather than a constraint violation with a Postgres error
    // code in it.
    let slug = request.system.slug;
    for (let attempt = 2; attempt <= 20; attempt += 1) {
      const { data: clash, error: clashError } = await supabase
        .from('brand_design_systems')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (clashError) throw new Error(`could not check the slug: ${clashError.message}`);
      if (!clash || (request.id && clash.id === request.id)) break;
      slug = slugify(`${request.system.slug}-${attempt}`);
    }

    const row = {
      name: request.system.name,
      slug,
      description: request.system.description,
      brand_hex: request.system.brandHex,
      options: request.system.options,
      origin: request.system.origin,
      brief: request.system.brief,
      // Null for everything authored or drafted from a brief; the seven grounds
      // for an import. Read all-seven-or-none on the way back out, so a
      // hand-edited column degrades to the preset rather than to half a
      // palette.
      neutrals: request.system.neutrals,
      source_namespace: request.system.sourceNamespace,
      imported_at: request.system.origin === 'imported' ? new Date().toISOString() : null,
      is_active: request.isActive,
      updated_at: new Date().toISOString(),
    };

    const saved = request.id
      ? await supabase.from('brand_design_systems').update(row).eq('id', request.id).select('id').maybeSingle()
      : await supabase
        .from('brand_design_systems')
        .insert({ ...row, created_by: auth.userId })
        .select('id')
        .maybeSingle();

    if (saved.error) throw new Error(`could not save the design system: ${saved.error.message}`);
    if (!saved.data) return json({ error: 'design system not found' }, 404);

    const response: BrandRouteResponse = {
      action: 'save',
      system: { ...request.system, slug },
      audit,
      id: String(saved.data.id),
      slug,
      brief: request.system.brief,
      durationMs: Date.now() - started,
    };
    return json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[generate-brand-design-system]', message);
    return json({ error: message }, 500);
  }
});

Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
