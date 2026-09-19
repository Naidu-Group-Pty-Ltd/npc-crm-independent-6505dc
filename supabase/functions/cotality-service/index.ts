// supabase/functions/cotality-service/index.ts
//
// Cotality (CoreLogic) data service — SCAFFOLDING ONLY.
//
// Status: awaiting sandbox credentials from Cotality.
// While COTALITY_API_KEY is unset, every endpoint returns a `modelled`
// envelope with confidence 0.3 so the renderer suppresses the figure
// (per docs/integrations/cotality-scoping.md).
//
// Endpoint contract (single POST entrypoint):
//   { branch: 1..10, field: string, propertyAddress?: string, postcode?: string, reportId?: string }
// → { value, source, confidence, licence_tag, fetched_at, cache_ttl_days, request_id }
//
// Once Cotality credentials are wired:
//   - replace each branch resolver's mock block with a real fetch
//   - persist the response to public.data_provenance
//   - bump confidence to 1.0 for live, 0.6 for cached <30d, 0.4 for cached >30d
//
// Spec: docs/integrations/cotality-scoping.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
type Source =
  | "cotality" | "abs" | "rba" | "bocsar" | "csa" | "qps"
  | "google" | "domain" | "modelled" | "manual" | "ptv" | "tfnsw" | "translink" | "walkscore";

interface ProvenanceEnvelope {
  value: number | string | null;
  source: Source;
  confidence: number;        // 0..1
  licence_tag: "cotality" | "public" | "derived" | "manual";
  fetched_at: string;
  cache_ttl_days: number;
  request_id: string;
  notes?: string;
}

const COTALITY_API_KEY = Deno.env.get("COTALITY_API_KEY");
const COTALITY_BASE_URL = Deno.env.get("COTALITY_BASE_URL") ?? "https://api.corelogic.asia/property/au/v2";

function modelled(field: string, notes = "Awaiting Cotality credentials"): ProvenanceEnvelope {
  return {
    value: null,
    source: "modelled",
    confidence: 0.3,
    licence_tag: "derived",
    fetched_at: new Date().toISOString(),
    cache_ttl_days: 0,
    request_id: crypto.randomUUID(),
    notes: `${field}: ${notes}`,
  };
}

// Branch resolvers — all stubbed until creds land.
// Each one documents the Cotality endpoint it will call.
const resolvers: Record<number, (field: string, ctx: Ctx) => Promise<ProvenanceEnvelope>> = {
  // Branch 1: Property attributes & AVM   → GET /properties/{id} + /avm/intellival/{id}
  1: async (field) => modelled(field, "Cotality Property Data API + AVM"),
  // Branch 2: Sales history & comparables → GET /properties/{id}/sales-history
  2: async (field) => modelled(field, "Cotality sales feed"),
  // Branch 3: Rental history & yield      → GET /properties/{id}/rental-history
  3: async (field) => modelled(field, "Cotality rental feed"),
  // Branch 4: Suburb market analytics     → GET /statistics/locality/{locality_id}
  4: async (field) => modelled(field, "Cotality Market Trends / Suburb Statistics"),
  // Branch 5: Planning / zoning           → hybrid: Cotality + state portals
  5: async (field) => modelled(field, "Cotality + Vicplan/ePlanning/DA Mapping"),
  // Branch 6: Build cost benchmarks       → Cordell Insights API
  6: async (field) => modelled(field, "Cordell Insights"),
  // Branch 7: Demographics                → Cotality demographics OR ABS fallback
  7: async (field) => modelled(field, "Cotality demographics / ABS fallback"),
  // Branch 8: Crime                       → out of Cotality scope (BOCSAR/CSA/QPS)
  8: async (field) => modelled(field, "Government feeds only — not Cotality"),
  // Branch 9: Climate / hazard risk       → Cotality Climate Risk (separate SKU)
  9: async (field) => modelled(field, "Cotality Climate Risk"),
  // Branch 10: Infrastructure / amenity   → Cotality POI + Google Places hybrid
  10: async (field) => modelled(field, "Cotality POI + Google Places"),
};

interface Ctx {
  propertyAddress?: string;
  postcode?: string;
  reportId?: string;
}

async function persistProvenance(
  supabase: any,
  branch: number,
  field: string,
  env: ProvenanceEnvelope,
  ctx: Ctx,
) {
  try {
    await supabase.from("data_provenance").insert({
      report_id: ctx.reportId ?? null,
      property_address: ctx.propertyAddress ?? null,
      branch,
      field_key: field,
      value_numeric: typeof env.value === "number" ? env.value : null,
      value_text: typeof env.value === "string" ? env.value : null,
      source: env.source,
      confidence: env.confidence,
      licence_tag: env.licence_tag,
      fetched_at: env.fetched_at,
      cache_ttl_days: env.cache_ttl_days,
      request_id: env.request_id,
    });
  } catch (e) {
    console.warn("[cotality-service] provenance insert failed", e);
  }
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error) return createUnauthorizedResponse(auth.error, corsHeaders);

    const branch = Number(body.branch);
    const field = String(body.field ?? "").trim();
    if (!branch || branch < 1 || branch > 10 || !field) {
      return new Response(
        JSON.stringify({ error: "branch (1–10) and field are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ctx: Ctx = {
      propertyAddress: body.propertyAddress,
      postcode: body.postcode,
      reportId: body.reportId,
    };

    const resolver = resolvers[branch];
    const envelope = await resolver(field, ctx);

    // Log live calls only — modelled stubs would flood the table.
    if (envelope.source !== "modelled" || ctx.reportId) {
      await persistProvenance(supabase, branch, field, envelope, ctx);
    }

    return new Response(JSON.stringify(envelope), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "x-cotality-status": COTALITY_API_KEY ? "live" : "scaffolding",
      },
    });
  } catch (err) {
    console.error("[cotality-service] error", err);
    return new Response(
      JSON.stringify(internalError(err, 'cotality-service')),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
