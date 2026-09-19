// Commercial / Industrial Cap Rate AI Estimator
// Returns a defensible cap-rate range (low / mid / high) and target cap rate
// for the supplied property snapshot, grounded in 2025 AU market evidence.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from "../_shared/auth.ts";
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';
import { checkModuleView } from "../_shared/permissions.ts";
import { consumeRateLimit, enforceJsonBodyLimit, securityJsonError } from "../_shared/requestSecurity.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';
interface Snapshot {
  propertyId?: string;
  dealId?: string;
  address?: string;
  state?: string | null;
  assetCategory?: string;
  assetSubtype?: string | null;
  gstTreatment?: string | null;
  purchasePrice?: number | null;
  valuation?: number | null;
  gfaSqm?: number | null;
  nlaSqm?: number | null;
  glaSqm?: number | null;
  siteAreaSqm?: number | null;
  hardstandSqm?: number | null;
  officePct?: number | null;
  parkingBays?: number | null;
  clearanceMetres?: number | null;
  yearBuilt?: number | null;
  zoning?: string | null;
  walesYears?: number | null;
  passingNoi?: number | null;
  marketNoi?: number | null;
  current?: Record<string, number | string | null | undefined>;
}

const MAX_REQUEST_BYTES = 32 * 1024;
const SNAPSHOT_KEYS = new Set([
  'propertyId', 'dealId', 'address', 'state', 'location', 'propertyType', 'assetCategory',
  'assetSubtype', 'gstTreatment', 'purchasePrice', 'valuation', 'gfaSqm', 'nlaSqm', 'glaSqm',
  'siteAreaSqm', 'siteCoverPct', 'hardstandSqm', 'officePct', 'parkingBays', 'clearanceMetres',
  'yearBuilt', 'zoning', 'walesYears', 'wale', 'passingNoi', 'marketNoi', 'actualNoi',
  'stabilisedNoi', 'lenderAdjustedNoi', 'tenant', 'tenantQuality', 'leaseStatus', 'leaseType',
  'leaseExpiry', 'currentRent', 'marketRent', 'vacancyAllowance', 'outgoingsRecovery',
  'currentPriceValue', 'ownershipEntity', 'current', 'riskWarnings', 'supportingInputsUsed',
  'missingInputs',
]);

function validSnapshotValue(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= 3) return false;
  if (Array.isArray(value)) return value.length <= 50 && value.every((item) => validSnapshotValue(item, depth + 1));
  if (typeof value !== 'object') return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= 50 && entries.every(([key, item]) => key.length <= 64 && validSnapshotValue(item, depth + 1));
}

export function isValidSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length > 0 && entries.every(([key, item]) => SNAPSHOT_KEYS.has(key) && validSnapshotValue(item));
}

const SYSTEM_PROMPT = `You are an Australian commercial / industrial property valuer specialising in capitalisation rate benchmarking for lender-grade feasibilities.

Given a specific property snapshot, return a defensible 2025 capitalisation-rate range in AUD market terms. Ground your estimate in:
- Current AU yield evidence by asset sub-type and state/metro
- Lease covenant / WALE strength implied by the snapshot
- Building grade, age and location signals (year built, zoning, area, office %, clearance, hardstand)
- Liquidity / risk premium for the sub-market

Hard rules:
- Return structured data for this specific property, not generic commentary.
- capRateRange.low, capRateRange.mid, capRateRange.high and recommendedTargetCapRate are percentages (e.g. 6.25 means 6.25%).
- The range must be plausible (low < mid < high) and within 3.5% – 12% for AU commercial/industrial assets.
- recommendedTargetCapRate must sit inside [low, high] and reflect the most likely transactional cap for this asset today.
- If passingNoi / marketNoi are present, the implied value at targetCapRatePct should be sense-checked against any purchasePrice / valuation; mention any material gap in reasoning.
- Never invent comparable transactions or tenant covenants not present in the snapshot.
- If the snapshot lacks critical data, still return a best-evidence estimate, include the missingInputs list, include the warning phrase "AI cap rate estimate accuracy is limited because key property details are missing.", and flag confidence as 'Low'.
- requiresValuerConfirmation must always be true.`;

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin') || '');
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const boundedBody = await enforceJsonBodyLimit<{ snapshot?: unknown; session_token?: string }>(req, MAX_REQUEST_BYTES);
    if (!boundedBody.ok) {
      const headers = new Headers(boundedBody.error.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
      return new Response(boundedBody.error.body, { status: boundedBody.error.status, headers });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = boundedBody.value;
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) return createUnauthorizedResponse(authError, corsHeaders);
    if (!userId) return createUnauthorizedResponse('Authentication required', corsHeaders);

    // Commercial & Industrial is a Scale-or-add-on capability — enforced
    // server-side, not just hidden in the UI.
    const entitlement = await requireWorkspaceCapability(supabase, { userId, authMethod }, 'commercial-industrial');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);

    const permission = await checkModuleView(supabase, userId, 'listings', authMethod);
    if (!permission.allowed) return securityJsonError(403, 'module_permission_denied');
    if (!isValidSnapshot(body.snapshot)) return securityJsonError(400, 'invalid_snapshot');

    if (authMethod !== 'service_role') {
      try {
        const [userLimit, globalLimit] = await Promise.all([
          consumeRateLimit(supabase, `caprate-estimate:user:${userId}`, 10, 3600),
          consumeRateLimit(supabase, 'caprate-estimate:global', 250, 86400),
        ]);
        if (!userLimit.allowed || !globalLimit.allowed) return securityJsonError(429, 'rate_limited');
      } catch {
        return securityJsonError(503, 'metering_unavailable');
      }
    }

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'LOVABLE_API_KEY not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const snap = body.snapshot;
    const userContext = `Estimate the capitalisation rate range for this specific property:\n\n${JSON.stringify(snap, null, 2)}\n\nReturn a single JSON object via the tool call. Be precise to this property's location, asset sub-type, covenant and grade. Do not return generic averages.`;

    const tools = [{
      type: 'function',
      function: {
        name: 'return_cap_rate_estimate',
        description: 'Return a precise capitalisation rate range for the given commercial / industrial property.',
        parameters: {
          type: 'object',
          properties: {
            propertyId: { type: 'string' },
            dealId: { type: 'string' },
            estimateType: { type: 'string', enum: ['CAP_RATE_RANGE'] },
            summary: { type: 'string' },
            capRateRange: { type: 'object', properties: { low: { type: 'number' }, mid: { type: 'number' }, high: { type: 'number' } }, required: ['low', 'mid', 'high'] },
            recommendedTargetCapRate: { type: 'number' },
            confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
            supportingInputsUsed: { type: 'array', items: { type: 'string' } },
            missingInputs: { type: 'array', items: { type: 'string' } },
            reasoningSummary: { type: 'string' },
            warnings: { type: 'array', items: { type: 'string' } },
            requiredDocuments: { type: 'array', items: { type: 'string' } },
            requiresValuerConfirmation: { type: 'boolean' },
            estimatedFields: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, currentValue: { type: 'number' }, estimatedValue: { type: 'number' }, unit: { type: 'string' }, confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] }, sourceStatusBefore: { type: 'string' }, sourceStatusAfter: { type: 'string' }, reasoningSummary: { type: 'string' }, requiresSpecialistReview: { type: 'boolean' }, requiredDocument: { type: 'string' }, shouldOverwrite: { type: 'boolean' } } } },
            recommendedNextAction: { type: 'string' },
          },
          required: ['propertyId', 'dealId', 'estimateType', 'summary', 'capRateRange', 'recommendedTargetCapRate', 'confidence', 'supportingInputsUsed', 'missingInputs', 'reasoningSummary', 'warnings', 'requiredDocuments', 'requiresValuerConfirmation', 'estimatedFields', 'recommendedNextAction'],
        },
      },
    }];

    const aiResp = await meteredFetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContext },
        ],
        tools,
        tool_choice: { type: 'function', function: { name: 'return_cap_rate_estimate' } },
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error('[estimate-commercial-caprate] AI error', aiResp.status, txt);
      const status = aiResp.status === 429 ? 429 : aiResp.status === 402 ? 402 : 502;
      const msg = aiResp.status === 429
        ? 'AI rate limit hit, please retry shortly.'
        : aiResp.status === 402
          ? 'Lovable AI credits exhausted. Add credits in Workspace → Usage.'
          : `AI gateway error: ${txt.slice(0, 300)}`;
      return new Response(JSON.stringify({ success: false, error: msg }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ success: false, error: 'AI returned no estimate' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let estimate: any;
    try {
      estimate = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error('[estimate-commercial-caprate] parse fail', e);
      return new Response(JSON.stringify({ success: false, error: 'Failed to parse AI estimate' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    estimate = { ...estimate, propertyId: estimate.propertyId || snap.propertyId || '', dealId: estimate.dealId || snap.dealId || snap.propertyId || '', estimateType: 'CAP_RATE_RANGE', requiresValuerConfirmation: true };
    return new Response(JSON.stringify({ success: true, estimate }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[estimate-commercial-caprate] fatal', err);
    return new Response(JSON.stringify({ ...internalError(err, 'estimate-commercial-caprate'), success: false }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
