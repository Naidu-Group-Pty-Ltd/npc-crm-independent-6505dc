// Commercial / Industrial NOI AI Estimator
// Takes a property snapshot (address, asset class, areas, valuation, etc.) and
// returns a precise set of NOI inputs (market rent, recoveries, vacancy %,
// outgoings line items) grounded in Australian commercial market norms.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from "../_shared/auth.ts";
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { buildNoiPromptSnapshot } from "./promptSnapshot.ts";
import { consumeRateLimit } from "../_shared/requestSecurity.ts";
import { isRequestBody, readBoundedJson, RequestTooLargeError } from "./requestGuards.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';
interface Snapshot {
  propertyId?: string;
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
  // Current entered values – AI should respect these unless clearly wrong
  current?: Record<string, number | string | null | undefined>;
  currentNoiInputs?: Record<string, any>;
  missingFields?: string[];
}

const SYSTEM_PROMPT = `You are an Australian commercial / industrial property valuer specialising in Net Operating Income (NOI) inputs for lender-grade feasibilities.

Given a specific property snapshot, return precise, defensible annual figures in AUD. Ground your estimates in:
- 2025 market rents (per sqm) for the asset sub-type and state/region
- Typical recoverability of outgoings under that lease type
- Standard council/water/land tax bands for the state
- Insurance, management, R&M ratios appropriate for the asset class

Hard rules:
- All monetary values are ANNUAL Australian dollars (whole numbers, no commas).
- vacancyAllowancePct is a percentage number (e.g. 5 means 5%), between 0 and 25.
- marketRentPa MUST be consistent with the lettable area (NLA / GLA / GFA) at a defensible $/sqm for the location and asset sub-type. If area is missing, derive from comparable yield × valuation.
- grossPassingRentPa should equal marketRentPa unless the snapshot indicates an under-/over-rented position.
- recoveredOutgoingsPa should reflect the lease type (net/triple-net ~ full recovery; gross ~ 0; semi-gross ~ partial). When unknown, assume net.
- outgoings line items must sum to a realistic % of marketRentPa (typically 12–25% for commercial, 5–12% for industrial).
- incentiveAdjustment and tenantRiskHaircut are positive AUD amounts representing deductions to stabilise NOI.
- Never invent tenant names, lease terms, or evidence not present in the snapshot.
- If the snapshot lacks critical data, still return your best evidence-based estimate and flag low confidence in 'confidence'.
Return structured field estimates for review; do not recommend overwriting verified, property-source, or client-profile-source values unless explicitly requested in the snapshot.`;


function buildStructuredNoiEstimate(snap: Snapshot, estimate: any) {
  const current = snap.currentNoiInputs ?? snap.current ?? {};
  const statuses = current.statuses ?? {};
  const protectedStatuses = ['Verified', 'Client Profile Source', 'Property Record Source'];
  const confidenceMap: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
  const confidence = confidenceMap[String(estimate.confidence || 'medium').toLowerCase()] || 'Medium';
  const currentValue = (field: string) => {
    if (field in current) return current[field];
    if (current.outgoings && field in current.outgoings) return current.outgoings[field];
    return null;
  };
  const isMissing = (value: unknown) => value == null || value === '' || value === 'unknown' || Number(value) === 0;
  const mk = (field: string, estimatedValue: unknown, unit = 'AUD pa') => {
    if (estimatedValue == null || estimatedValue === 'unknown') return null;
    const sourceStatusBefore = statuses[field] ?? (isMissing(currentValue(field)) ? 'Unknown' : 'Manual Estimate');
    return {
      field,
      currentValue: currentValue(field),
      estimatedValue,
      unit,
      confidence,
      sourceStatusBefore,
      sourceStatusAfter: 'AI Estimate',
      reasoningSummary: estimate.reasoning || `Estimated from selected property context for ${snap.address || snap.propertyId || 'the selected property'}.`,
      requiresSpecialistReview: confidence === 'Low',
      requiredDocument: confidence === 'Low' ? 'Current lease, rent roll and outgoings statement' : '',
      shouldOverwrite: !protectedStatuses.includes(sourceStatusBefore) && isMissing(currentValue(field)),
    };
  };
  const fields = [
    mk('marketRent', estimate.marketRentPa),
    mk('grossRent', estimate.grossPassingRentPa ?? estimate.marketRentPa),
    mk('other', estimate.otherIncomePa),
    mk('recovered', estimate.recoveredOutgoingsPa),
    mk('vacancy', estimate.vacancyAllowancePct, '%'),
    mk('incentiveAdjustment', estimate.incentiveAdjustment),
    mk('tenantRiskHaircut', estimate.tenantRiskHaircut),
    mk('leaseType', estimate.leaseTypeAssumed, ''),
    ...Object.entries(estimate.outgoings ?? {}).map(([field, value]) => mk(field, value)),
  ].filter(Boolean);
  const warnings = [];
  if (!snap.address || !snap.assetSubtype || !(snap.glaSqm || snap.nlaSqm || snap.gfaSqm) || !snap.siteAreaSqm) warnings.push('AI estimate accuracy is limited because key property details are missing.');
  if (!current.leaseType || current.leaseType === 'unknown') warnings.push('No verified lease data available; lease type requires specialist review.');
  if (confidence === 'Low') warnings.push('AI estimate confidence is low; specialist review required.');
  const requiredDocuments = confidence === 'Low' ? ['Current lease', 'Rent roll', 'Outgoings statement'] : [];
  return {
    propertyId: snap.propertyId ?? '',
    dealId: (snap as any).dealId ?? snap.propertyId ?? '',
    estimateType: 'NOI',
    summary: estimate.reasoning || 'Property-aware NOI estimate generated for review.',
    estimatedFields: fields,
    calculatedOutputs: {
      potentialGrossIncome: null,
      vacancyLoss: null,
      recoveredOutgoings: estimate.recoveredOutgoingsPa ?? null,
      effectiveGrossIncome: null,
      totalOutgoings: Object.values(estimate.outgoings ?? {}).reduce((a: number, b: any) => a + (Number(b) || 0), 0),
      ownerBorneOutgoings: null,
      actualNOI: null,
      stabilisedNOI: null,
      lenderAdjustedNOI: null,
    },
    warnings,
    requiredDocuments,
    recommendedNextAction: 'Review proposed fields, accept selected estimates only, and verify protected assumptions against source documents.',
  };
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin') || '');
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const parsedBody = await readBoundedJson(req);
    if (!isRequestBody(parsedBody)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid request body' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const body = parsedBody;
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) return createUnauthorizedResponse(authError, corsHeaders);

    // Commercial & Industrial is a Scale-or-add-on capability — enforced
    // server-side, not just hidden in the UI.
    const entitlement = await requireWorkspaceCapability(supabase, { userId, authMethod }, 'commercial-industrial');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);

    // The database-backed bucket is shared across isolates, so horizontal scaling
    // cannot bypass the paid-AI allowance. Fail closed if metering is unavailable.
    const quota = await consumeRateLimit(supabase, `ai:noi:user:${userId}`, 10, 60);
    if (!quota.allowed) {
      return new Response(JSON.stringify({ success: false, error: 'Too many estimate requests. Please retry shortly.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(quota.retryAfterSeconds) },
      });
    }

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'LOVABLE_API_KEY not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const snap = (body.snapshot ?? {}) as Snapshot;
    const promptSnapshot = buildNoiPromptSnapshot(snap);
    const userContext = `Estimate NOI inputs for this specific property:\n\n${JSON.stringify(promptSnapshot, null, 2)}\n\nReturn a single JSON object via the tool call. Be precise to this property's location, asset sub-type and area. Do not return generic averages.`;

    const tools = [{
      type: 'function',
      function: {
        name: 'return_noi_estimate',
        description: 'Return a precise NOI estimate for the given commercial / industrial property.',
        parameters: {
          type: 'object',
          properties: {
            marketRentPa: { type: 'number', description: 'Annual market rent in AUD.' },
            grossPassingRentPa: { type: 'number', description: 'Annual passing rent in AUD.' },
            otherIncomePa: { type: 'number' },
            recoveredOutgoingsPa: { type: 'number' },
            vacancyAllowancePct: { type: 'number' },
            incentiveAdjustment: { type: 'number' },
            tenantRiskHaircut: { type: 'number' },
            leaseTypeAssumed: { type: 'string', enum: ['gross', 'net', 'semiGross', 'tripleNet', 'unknown'] },
            outgoings: {
              type: 'object',
              properties: {
                council: { type: 'number' },
                water: { type: 'number' },
                land_tax: { type: 'number' },
                insurance: { type: 'number' },
                management: { type: 'number' },
                repairs_maintenance: { type: 'number' },
                utilities: { type: 'number' },
                cleaning: { type: 'number' },
                security: { type: 'number' },
                other: { type: 'number' },
              },
              required: ['council', 'water', 'land_tax', 'insurance', 'management', 'repairs_maintenance'],
            },
            ratePerSqm: { type: 'number', description: 'Implied $/sqm used.' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            reasoning: { type: 'string', description: '2-4 sentences explaining assumptions.' },
          },
          required: ['marketRentPa', 'recoveredOutgoingsPa', 'vacancyAllowancePct', 'outgoings', 'confidence', 'reasoning'],
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
        tool_choice: { type: 'function', function: { name: 'return_noi_estimate' } },
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error('[estimate-commercial-noi] AI error', aiResp.status, txt);
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
      console.error('[estimate-commercial-noi] parse fail', e);
      return new Response(JSON.stringify({ success: false, error: 'Failed to parse AI estimate' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: true, estimate: buildStructuredNoiEstimate(snap, estimate), rawEstimate: estimate }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[estimate-commercial-noi] fatal', err);
    if (err instanceof RequestTooLargeError) {
      return new Response(JSON.stringify({ success: false, error: err.message }), { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (err?.message === 'Rate limit unavailable') {
      return new Response(JSON.stringify({ success: false, error: 'Estimate service temporarily unavailable' }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ...internalError(err, 'estimate-commercial-noi'), success: false }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
