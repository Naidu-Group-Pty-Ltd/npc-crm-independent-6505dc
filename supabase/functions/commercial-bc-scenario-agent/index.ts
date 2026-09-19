// Commercial / Industrial BC AI Scenario Agent
// Accepts current scenario snapshot + user prompt + chat history
// Returns 2-3 actionable scenario proposals with field overrides that can be
// cascaded into the calculator state on the client.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from "../_shared/auth.ts";
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';
import { consumeRateLimit, enforceJsonBodyLimit } from "../_shared/requestSecurity.ts";
import { extractOpenAIUsage, logApiUsage } from "../_shared/logApiUsage.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
interface ChatTurn { role: 'user' | 'assistant'; content: string; }

interface Snapshot {
  assetCategory?: string;
  assetSubtype?: string;
  state?: string;
  purpose?: string;
  leaseStatus?: string;
  purchasePrice?: number;
  estimatedValue?: number;
  proposedLoan?: number;
  availableEquity?: number;
  sponsorLiquidity?: number;
  businessEbitda?: number;
  businessDebt?: number;
  marketRent?: number;
  vacancy?: number;
  rate?: number;
  buffer?: number;
  term?: number;
  maxLvr?: number;
  minDscr?: number;
  minIcr?: number;
  profile?: string;
  gstTreatment?: string;
  riskRating?: string;
  borrowingCapacity?: number;
  dscr?: number;
  icr?: number;
  noi?: number;
  client?: { id?: string; name?: string };
  portfolio?: Record<string, unknown>;
}

interface RequestBody {
  prompt: string;
  history?: ChatTurn[];
  snapshot?: Snapshot;
  clientId?: string;
  session_token?: string;
}

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_PROMPT_CHARS = 4_000;
const MAX_HISTORY_TURNS = 8;
const MAX_TURN_CHARS = 4_000;
const MAX_SNAPSHOT_CHARS = 32_000;
const AI_TIMEOUT_MS = 30_000;
const AI_MAX_TOKENS = 1_200;

const jsonError = (corsHeaders: Record<string, string>, status: number, error: string) =>
  new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const SYSTEM_PROMPT = `You are a senior Australian commercial / industrial property finance strategist.
Given a client's current borrowing-capacity snapshot, propose 2 to 3 distinct, actionable scenarios that could improve their position (e.g. increase borrowing capacity, reduce risk, improve DSCR/ICR/LVR, secure a different lender policy, restructure the deal).

Each proposal MUST be concrete and ready to cascade into a calculator. For each scenario:
- name: short, distinct label (max 60 chars)
- reasoning: 1-2 sentence why
- estimatedImpact: short qualitative summary (e.g. "+$420k capacity, DSCR 1.45x")
- executionRisk: low | medium | high
- evidenceRequired: 2-4 bullets of evidence the broker must gather
- adjustments: object with ONLY the fields the user should change (omit keys that should stay the same). Numbers as numbers, not strings.

Allowed adjustment keys (use exact names):
  purchasePrice, estimatedValue, proposedLoan, availableEquity, sponsorLiquidity,
  businessEbitda, businessDebt, currentRent, proposedRent,
  passingRent, marketRent, vacancy, recoveries, rates, water, landTax, insurance, management, repairs,
  rate, buffer, term, ioPeriod, amortisation, maxLvr, minIcr, minDscr, minDebtYield,
  profile (one of: conservativeBank, mainstreamCommercialBank, nonBankCommercial, privateCreditShortTerm, smsfCommercial, ownerOccupiedBusinessLending, custom),
  gstTreatment (one of: gstInclusive, plusGst, gstFreeGoingConcern, marginScheme, unknown),
  leaseStatus (one of: fullyLeased, partiallyLeased, vacant, monthToMonth, relatedPartyLease, leasePending),
  guarantees (yes | no | unknown),
  relatedPartyTenant (yes | no),
  scenarioType (one of: Acquire Commercial Asset, Acquire Industrial Asset, Owner-Occupied Business Premises, Related-Party Lease Structure, Sell Existing Asset, Refinance Existing Debt, Equity Release, Debt Restructure, Cash Injection, Interest Rate Stress, Vacancy / Rent Stress, Capex Shock, Multi-Asset Strategy)

Keep responses concise. Do not hallucinate client portfolio details that were not provided in the snapshot.`;

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin') || '');
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const boundedBody = await enforceJsonBodyLimit<RequestBody>(req, MAX_REQUEST_BYTES);
    if (!boundedBody.ok) return jsonError(corsHeaders, boundedBody.error.status, boundedBody.error.status === 413 ? 'request is too large' : 'invalid JSON request');
    const body = boundedBody.value;
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) return createUnauthorizedResponse(authError, corsHeaders);

    // Commercial & Industrial is a Scale-or-add-on capability — enforced
    // server-side, not just hidden in the UI.
    const entitlement = await requireWorkspaceCapability(supabase, { userId, authMethod }, 'commercial-industrial');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);

    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      return new Response(JSON.stringify({ success: false, error: 'prompt is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (prompt.length > MAX_PROMPT_CHARS) return jsonError(corsHeaders, 413, 'prompt is too large');

    if (body.history !== undefined && (!Array.isArray(body.history) || body.history.length > MAX_HISTORY_TURNS || body.history.some(turn =>
      !turn || (turn.role !== 'user' && turn.role !== 'assistant') || typeof turn.content !== 'string' || turn.content.length > MAX_TURN_CHARS
    ))) return jsonError(corsHeaders, 400, 'invalid history');

    const snapshotJson = JSON.stringify(body.snapshot ?? {});
    if (snapshotJson.length > MAX_SNAPSHOT_CHARS) return jsonError(corsHeaders, 413, 'snapshot is too large');

    if (!userId) return jsonError(corsHeaders, 401, 'Authentication required');
    try {
      const [minuteLimit, dailyLimit] = await Promise.all([
        consumeRateLimit(supabase, `commercial-bc-ai:user:${userId}:minute`, 10, 60),
        consumeRateLimit(supabase, `commercial-bc-ai:user:${userId}:day`, 100, 86_400),
      ]);
      if (!minuteLimit.allowed || !dailyLimit.allowed) return jsonError(corsHeaders, 429, 'AI request limit reached. Please try again later.');
    } catch (error) {
      console.error('[commercial-bc-scenario-agent] rate limit unavailable', error);
      return jsonError(corsHeaders, 503, 'AI request controls are temporarily unavailable.');
    }

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'LOVABLE_API_KEY not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userContext = `## Current snapshot
${snapshotJson}

## Conversation so far
${(body.history ?? []).map(t => `${t.role}: ${t.content}`).join('\n')}

## User request
${prompt}`;

    const tools = [{
      type: 'function',
      function: {
        name: 'propose_scenarios',
        description: 'Return 2-3 commercial / industrial borrowing capacity scenario proposals.',
        parameters: {
          type: 'object',
          properties: {
            scenarios: {
              type: 'array',
              minItems: 2,
              maxItems: 3,
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  reasoning: { type: 'string' },
                  estimatedImpact: { type: 'string' },
                  executionRisk: { type: 'string', enum: ['low', 'medium', 'high'] },
                  evidenceRequired: { type: 'array', items: { type: 'string' } },
                  adjustments: { type: 'object', additionalProperties: true },
                },
                required: ['name', 'reasoning', 'estimatedImpact', 'executionRisk', 'adjustments'],
              },
            },
          },
          required: ['scenarios'],
        },
      },
    }];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    const startedAt = Date.now();
    let aiResp: Response;
    try {
      aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContext },
          ],
          tools,
          tool_choice: { type: 'function', function: { name: 'propose_scenarios' } },
          max_tokens: AI_MAX_TOKENS,
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return jsonError(corsHeaders, 504, 'AI gateway timed out. Please try again.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error('[commercial-bc-scenario-agent] AI error', aiResp.status, txt);
      const status = aiResp.status === 429 ? 429 : aiResp.status === 402 ? 402 : 502;
      return new Response(JSON.stringify({ success: false, error: aiResp.status === 429 ? 'AI rate limit hit, please retry shortly.' : aiResp.status === 402 ? 'Lovable AI credits exhausted. Add credits in Workspace → Usage.' : `AI gateway error: ${txt.slice(0, 300)}` }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiJson = await aiResp.json();
    const usage = extractOpenAIUsage(aiJson);
    await logApiUsage(supabase, {
      service_name: 'lovable-ai', endpoint: '/v1/chat/completions', model_used: 'gemini-2.5-flash',
      ...usage, response_time_ms: Date.now() - startedAt, user_id: userId ?? undefined,
      metadata: { function: 'commercial-bc-scenario-agent' },
    });
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    let scenarios: unknown[] = [];
    let assistantText = aiJson.choices?.[0]?.message?.content || '';
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        scenarios = Array.isArray(parsed.scenarios) ? parsed.scenarios : [];
      } catch (e) {
        console.error('[commercial-bc-scenario-agent] tool parse failed', e);
      }
    }
    if (!assistantText) {
      assistantText = scenarios.length
        ? `Drafted ${scenarios.length} scenario option${scenarios.length === 1 ? '' : 's'} based on the current snapshot. Review the cards below and click Apply to cascade into the calculator.`
        : 'No scenario proposals were generated. Try a more specific prompt (e.g. "How can we lift borrowing capacity if we sell the warehouse?").';
    }

    return new Response(JSON.stringify({ success: true, assistantText, scenarios }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[commercial-bc-scenario-agent] fatal', err);
    return new Response(JSON.stringify({ ...internalError(err, 'commercial-bc-scenario-agent'), success: false }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
