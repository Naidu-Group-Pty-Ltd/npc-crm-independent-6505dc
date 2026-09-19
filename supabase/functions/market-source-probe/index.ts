/**
 * Read-only reachability probe for market-evidence sources.
 *
 * ## What this is for
 *
 * Two questions could not be answered from outside the deployment, and both
 * gate the Canonical Market Evidence work (audit §47-§51):
 *
 *  1. **Is a market-data credential present in this project's environment?**
 *     `integration_configs` holds an empty row, `update-integration-secret`
 *     writes the environment rather than that table, and the audit log that
 *     would have recorded a change was itself broken (§50). Only the runtime
 *     can see `Deno.env`.
 *  2. **Does the Supabase egress reach the government sources that refuse this
 *     repository's tooling?** `land.vic.gov.au` answers 403 and the NSW Valuer
 *     General 502 from the development egress, exactly as directory.gov.au and
 *     aph.gov.au did during the PEP work — where the answer turned out to be
 *     that the two egresses differ.
 *
 * ## Four rules
 *
 * **Nothing is written.** No table, no report, no score. This function exists
 * to answer questions, and a diagnostic that mutates is a diagnostic nobody
 * dares run.
 *
 * **A credential is never returned, logged or echoed** — only whether a name is
 * SET. Not its length, not a prefix, not a masked form: a length is a hint and
 * a prefix identifies the issuer.
 *
 * **Targets come from this module, never from the request.** A probe that took
 * a URL from the caller would be server-side request forgery in a function
 * holding the service-role key. The body selects a target by NAME from
 * {@link TARGETS} and nothing else.
 *
 * **A failure is classified, not summarised.** "Unavailable" sent the last
 * investigation to the wrong remedy twice; credential-absent, credential-
 * invalid, scope-missing, package-not-entitled, route-not-found, rate-limited
 * and reachable are different findings with different owners.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from "../_shared/errorResponse.ts";

/**
 * Credential names to report presence for. Presence only — never a value.
 *
 * Both providers are listed under their CURRENT and LEGACY shapes, because the
 * repository models each as a single API key while both APIs in fact want
 * OAuth2 client credentials (§51, §52). Which names exist is the evidence that
 * settles whether an integration was configured, half-configured, or
 * configured against a contract the vendor has since replaced.
 */
const CREDENTIAL_NAMES = [
  // Domain: legacy X-Api-Key, then the client-credentials pair.
  "DOMAIN_API_KEY",
  "DOMAIN_CLIENT_ID",
  "DOMAIN_CLIENT_SECRET",
  // Cotality/CoreLogic: legacy single key, then the client-credentials pair.
  "COTALITY_API_KEY",
  "COTALITY_CLIENT_ID",
  "COTALITY_CLIENT_SECRET",
  "COTALITY_BASE_URL",
  // PropTrack is REA Group's data arm — the LICENSED route to
  // realestate.com.au's data. Scraping the consumer site is refused by REA's
  // own robots.txt in as many words, so it is not a route this platform takes.
  "PROPTRACK_API_KEY",
  "PROPTRACK_BASE_URL",
  // Pricefinder (sales evidence) and SQM Research (vacancy, stock on market)
  // — the only declared source for a vacancy rate at suburb grain.
  "PRICEFINDER_API_KEY",
  "SQM_RESEARCH_API_KEY",
] as const;

/**
 * How a provider stands, before any network call.
 *
 * `licensing_unverified` is deliberately its own state and not a failure: a
 * provider can be perfectly reachable and correctly credentialled and still be
 * unusable in a client-facing report, because redistribution rights are a
 * commercial fact rather than a technical one. Cotality's own scoping
 * document leaves those questions open, so nothing may assume them.
 */
type ProviderStatus =
  | "configured_and_testable"
  | "credential_absent"
  | "authentication_implementation_obsolete"
  | "entitlement_unavailable"
  | "licensing_unverified";

/**
 * Whether a target is somebody we could hold an account with.
 *
 * This decides whether "not entitled" is even a sentence that can be true. A
 * government publisher has no entitlement to grant, so a 403 from one is an
 * origin refusal — and calling it an entitlement problem sends an operator to
 * negotiate with a vendor that does not exist. The first live run did exactly
 * that to a Victorian Government spreadsheet.
 */
type TargetKind = "commercial" | "government";

/**
 * How this probe authenticates a target, when it can at all.
 *
 * `not_implemented` is a real and honest state: Cotality wants an OAuth token
 * exchange this diagnostic does not perform, and PropTrack publishes no
 * documentation at all, so we do not know what header its key goes in.
 * Guessing one would be inventing a contract — the exact thing this programme
 * refuses — so the probe says it did not authenticate rather than reporting an
 * unauthenticated refusal as an entitlement finding.
 */
type AuthMethod = "domain_api_key" | "not_implemented" | "none_required";

interface Target {
  /** How the caller names it. */
  id: string;
  url: string;
  /** Bytes to request; a range keeps a probe cheap against a large file. */
  rangeBytes?: number;
  note: string;
  kind: TargetKind;
  /**
   * Credential names that would authenticate THIS target. Presence of these in
   * the runtime is what decides whether a credential was actually sent — never
   * an assumption, which is what the first version got wrong.
   */
  credentialNames: readonly string[];
  auth: AuthMethod;
}

/**
 * The only URLs this function will ever request.
 *
 * WA's SLIP platform is deliberately absent: its licence bars commercial
 * republication, so the platform does not fetch it at all.
 */
const TARGETS: readonly Target[] = [
  {
    id: "domain_v2_suburb_performance",
    url:
      "https://api.domain.com.au/v2/suburbPerformanceStatistics/NSW/Bowral/2576" +
      "?propertyCategory=house&chronologicalSpan=12&tPlusFrom=1&tPlusTo=12",
    note: "Domain Properties & Locations — the v2 route the repo does not yet call.",
    kind: "commercial",
    credentialNames: ["DOMAIN_API_KEY", "DOMAIN_CLIENT_ID", "DOMAIN_CLIENT_SECRET"],
    auth: "domain_api_key",
  },
  {
    id: "domain_v1_suburb_performance",
    url:
      "https://api.domain.com.au/v1/suburbPerformanceStatistics/NSW/Bowral" +
      "?propertyCategory=house&chronologicalSpan=12&tPlusFrom=1&tPlusTo=12",
    note: "Domain v1 Suburb Performance — DEPRECATED by Domain and replaced by v2. Kept as a control proving the old route is gone, never as a live blocker: the production adapter targets v2.",
    kind: "commercial",
    credentialNames: ["DOMAIN_API_KEY", "DOMAIN_CLIENT_ID", "DOMAIN_CLIENT_SECRET"],
    auth: "domain_api_key",
  },
  {
    // A SECOND Domain package, so one run can tell "the key works for nothing"
    // from "the key works, and Suburb Performance is not in this project".
    // Domain's documentation is explicit that no endpoint is reachable until
    // the required package is added to the project — so a valid-but-unpackaged
    // key answers 403 on every product alike, while an invalid key answers 401
    // on all of them. Two products, one round trip, and the pair is the
    // diagnosis. This is Domain's own documented read-only Address Suggestion
    // route, not an endpoint invented for testing.
    id: "domain_address_suggest",
    url: "https://api.domain.com.au/v1/properties/_suggest?terms=1%20Bowral%20Street%20Bowral%20NSW&pageSize=1",
    note: "Domain Address Suggestion — a DIFFERENT package on the same key, separating key validity from product entitlement.",
    kind: "commercial",
    credentialNames: ["DOMAIN_API_KEY", "DOMAIN_CLIENT_ID", "DOMAIN_CLIENT_SECRET"],
    auth: "domain_api_key",
  },
  {
    // Cotality/CoreLogic suburb statistics — branch 4 of the scoping spec
    // ("Market Trends / Suburb Stats"). The host is the default configured in
    // cotality-service; COTALITY_BASE_URL overrides it at runtime, and that is
    // SERVER configuration rather than caller input, so it cannot be used to
    // point this function at an arbitrary host.
    id: "cotality_suburb_statistics",
    url: "https://api.corelogic.asia/property/au/v2/statistics/locality/1234",
    note: "Cotality Market Trends / Suburb Statistics — the branch-4 endpoint shape.",
    kind: "commercial",
    credentialNames: ["COTALITY_API_KEY", "COTALITY_CLIENT_ID", "COTALITY_CLIENT_SECRET"],
    auth: "not_implemented",
  },
  {
    id: "proptrack_market_api",
    url:
      "https://data.proptrack.com/api/v2/market/sale/historic-median-sale-price" +
      "?suburb=Bowral&state=NSW&postcode=2576&propertyTypes=house&frequency=monthly",
    note: "PropTrack (REA Group) historic median sale price — the licensed realestate.com.au route.",
    kind: "commercial",
    credentialNames: ["PROPTRACK_API_KEY"],
    auth: "not_implemented",
  },
  {
    id: "vic_data_catalogue",
    url: "https://discover.data.vic.gov.au/api/3/action/package_search?q=median+house+suburb&rows=1",
    rangeBytes: 2048,
    note: "Victorian open-data CATALOGUE. Reachable where the file host is not.",
    kind: "government",
    credentialNames: [],
    auth: "none_required",
  },
  {
    id: "qld_statistician",
    url: "https://www.qgso.qld.gov.au/",
    rangeBytes: 2048,
    note: "Queensland Government Statistician — median sales by suburb publisher.",
    kind: "government",
    credentialNames: [],
    auth: "none_required",
  },
  {
    id: "vic_median_house_by_suburb",
    url: "https://www.land.vic.gov.au/__data/assets/excel_doc/0032/756581/houses-by-suburb-2014-2024.xlsx",
    rangeBytes: 2048,
    note: "Victorian Property Sales Report, median house by suburb 2014-2024. CC-BY 4.0.",
    kind: "government",
    credentialNames: [],
    auth: "none_required",
  },
  {
    id: "nsw_valuer_general_psi",
    url: "https://www.valuation.property.nsw.gov.au/embed/propertySalesInformation",
    rangeBytes: 2048,
    note: "NSW Valuer General bulk property sales index page.",
    kind: "government",
    credentialNames: [],
    auth: "none_required",
  },
  {
    id: "sa_data_portal",
    url: "https://data.sa.gov.au/data/api/3/action/package_search?q=metro+median+house+sales&rows=1",
    rangeBytes: 2048,
    note: "data.sa.gov.au CKAN — metro median house sales.",
    kind: "government",
    credentialNames: [],
    auth: "none_required",
  },
  {
    id: "abs_res_dwell",
    url: "https://data.api.abs.gov.au/rest/data/ABS,RES_DWELL,/all?startPeriod=2026-Q1",
    rangeBytes: 2048,
    note: "ABS RES_DWELL — regional benchmark/context layer.",
    kind: "government",
    credentialNames: [],
    auth: "none_required",
  },
];

/** What a probe outcome means, in the operator's terms. */
type Verdict =
  | "reachable"
  | "credential_absent"
  | "credential_invalid_or_scope_missing"
  | "not_entitled"
  | "route_not_found"
  | "rate_limited"
  | "blocked_by_origin"
  | "server_error"
  | "unreachable";

/**
 * A verdict is HTTP status + whether a credential was actually sent + what
 * kind of party answered. Never the status alone.
 *
 * The first live run proved why. `classify(status, isDomain ? … : true)` told
 * this function a credential had been sent for every non-Domain target, so an
 * unauthenticated 401 from Cotality was reported as "credential rejected, or
 * scope missing" — advice to check a credential that does not exist — and an
 * unauthenticated 403 from a Victorian Government spreadsheet was reported as
 * "not entitled", owner `commercial`, with the note that entitlement is added
 * to the account. There is no account. That is a fabricated finding pointing at
 * a fabricated relationship, and it is exactly the class of error this
 * programme exists to remove.
 *
 * Two rules follow. **An unauthenticated refusal says nothing about
 * entitlement** — it is a statement about a request that carried no identity.
 * And **only a commercial party can withhold an entitlement**: a government
 * publisher's 403 is an origin refusal however the request was made.
 */
function classify(status: number, credentialSent: boolean, kind: TargetKind): Verdict {
  if (status >= 200 && status < 300) return "reachable";
  if (status === 404) return "route_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if (status === 401) {
    return credentialSent ? "credential_invalid_or_scope_missing" : "credential_absent";
  }
  if (status === 403) {
    // Entitlement is a thing a vendor grants. Nobody holds an account with a
    // state government's file server, so its refusal is about the origin.
    if (kind === "government") return "blocked_by_origin";
    return credentialSent ? "not_entitled" : "blocked_by_origin";
  }
  return "unreachable";
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    const { error: authError } = await verifyAuth(supabase, req.headers, body);
    if (authError) return createUnauthorizedResponse(authError, corsHeaders);

    // Presence only. Never a value, never a length, never a prefix.
    const credentials: Record<string, boolean> = {};
    for (const name of CREDENTIAL_NAMES) {
      credentials[name] = Boolean(Deno.env.get(name)?.trim());
    }
    const hasDomainKey = credentials.DOMAIN_API_KEY === true;
    const hasDomainOAuth =
      credentials.DOMAIN_CLIENT_ID === true && credentials.DOMAIN_CLIENT_SECRET === true;

    // A caller may narrow to some targets BY NAME. It can never supply a URL.
    const requested: unknown = (body as Record<string, unknown>)?.targets;
    const wanted = Array.isArray(requested)
      ? TARGETS.filter((t) => requested.includes(t.id))
      : TARGETS;

    /** Does the runtime hold any credential that would authenticate this target? */
    const anyCredentialFor = (t: Target) => t.credentialNames.some((n) => credentials[n] === true);

    const results = [];
    for (const target of wanted) {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (target.rangeBytes) headers["Range"] = `bytes=0-${target.rangeBytes - 1}`;

      // Whether a credential is actually PUT ON THE WIRE — never assumed. A
      // provider whose scheme this probe does not implement is authenticated
      // by nothing, and its refusal must be read that way.
      let credentialSent = false;
      if (target.auth === "domain_api_key" && credentials.DOMAIN_API_KEY === true) {
        headers["X-Api-Key"] = Deno.env.get("DOMAIN_API_KEY")!;
        credentialSent = true;
      }

      const startedAt = Date.now();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        const response = await fetch(target.url, {
          method: "GET",
          headers,
          signal: controller.signal,
          redirect: "follow",
        });
        clearTimeout(timer);
        const text = await response.text();
        results.push({
          id: target.id,
          note: target.note,
          status: response.status,
          verdict: classify(response.status, credentialSent, target.kind),
          kind: target.kind,
          /** Whether a credential reached the wire. The reader states it plainly. */
          credentialSent,
          /**
           * Set when credentials EXIST for this provider but the probe cannot
           * use them. Cotality needs an OAuth token exchange this diagnostic
           * does not perform; PropTrack publishes no documentation, so the
           * header its key belongs in is unknown and inventing one would be
           * fabricating a contract.
           */
          authNotImplemented: target.auth === "not_implemented" && anyCredentialFor(target),
          contentType: response.headers.get("content-type"),
          contentLength: response.headers.get("content-length"),
          bytesRead: text.length,
          // Bounded, and only ever the provider's own diagnostic text. A
          // credential is never echoed: nothing here reads the request headers.
          bodyPreview: text.slice(0, 400),
          /**
           * The provider's own signals, for diagnosing a refusal without a
           * second round trip. Deliberately an ALLOW-LIST: `authorization`,
           * `cookie` and `set-cookie` are never read, so no credential or
           * session material can travel out in this field.
           */
          providerHeaders: Object.fromEntries(
            ([
              // Domain's OWN canonical diagnostic for 401/403 — their
              // troubleshooting guidance names it as the first thing to read.
              // It carries a reason phrase, never credential material.
              "x-domain-security-reason",
              "www-authenticate", "x-quota-perminute-limit", "x-quota-perminute-remaining",
              "x-quota-perday-limit", "x-quota-perday-remaining", "retry-after",
              "x-ratelimit-remaining", "server", "cf-ray", "x-amzn-errortype",
            ] as const)
              .map((h) => [h, response.headers.get(h)])
              .filter(([, v]) => v !== null),
          ),
          /**
           * Lifted out of the header map because it is the one header that
           * decides the verdict's meaning. Domain names it as the first
           * diagnostic for a 401 or 403, and a 403 without it is an
           * unexplained refusal rather than an entitlement finding.
           */
          securityReason: response.headers.get("x-domain-security-reason"),
          elapsedMs: Date.now() - startedAt,
        });
      } catch (cause) {
        results.push({
          id: target.id,
          note: target.note,
          status: 0,
          verdict: "unreachable" as Verdict,
          error: cause instanceof Error ? cause.message : String(cause),
          elapsedMs: Date.now() - startedAt,
        });
      }
    }

    // Classify each provider from what is configured, before the network says
    // anything. A provider with no credential cannot be distinguished from one
    // with a bad credential by its 401 alone, which is why presence is read
    // from the environment rather than inferred from a status code.
    const hasCotalityKey = credentials.COTALITY_API_KEY === true;
    const hasCotalityOAuth =
      credentials.COTALITY_CLIENT_ID === true && credentials.COTALITY_CLIENT_SECRET === true;

    const providers = {
      // Domain documents TWO current authentication schemes side by side:
      // an API key (X-API-Key header, or an api_key query parameter) AND OAuth2
      // client credentials. ME-6 read that from Domain's own public developer
      // portal, which corrects what ME-5.1 inferred from an error code: the API
      // key is NOT obsolete, and calling it so sent an operator to replace a
      // working scheme. Either credential shape is therefore testable.
      domain: {
        status: (hasDomainOAuth || hasDomainKey
          ? "configured_and_testable"
          : "credential_absent") as ProviderStatus,
        authScheme: hasDomainOAuth
          ? "oauth_client_credentials"
          : hasDomainKey
            ? "api_key"
            : "none",
        // Of the three counts ME-5.1 called legacy, exactly one survives. v1 is
        // gone (404 "No Matching Route"); v2 exists in BOTH {state}/{suburb} and
        // {state}/{suburb}/{postcode} shapes, so the path was never wrong; and
        // X-API-Key is a documented current scheme. Only the version prefix.
        repositoryImplementation: "v1 route (removed by Domain) — the version prefix is the only defect; X-API-Key remains a documented scheme",
        licensingStatus: "not_assessed",
      },
      cotality: {
        status: (hasCotalityOAuth
          ? "configured_and_testable"
          : hasCotalityKey
            ? "authentication_implementation_obsolete"
            : "credential_absent") as ProviderStatus,
        authScheme: hasCotalityOAuth ? "oauth_client_credentials" : hasCotalityKey ? "api_key_legacy" : "none",
        // Every branch resolver is a stub: there is no fetch to Cotality
        // anywhere in cotality-service, so a credential alone changes nothing.
        repositoryImplementation: "scaffolding only — no outbound call exists",
        // A production gate, never a development blocker. Cotality's own
        // scoping spec leaves cache duration, redistribution rights for
        // client-facing PDFs, and the right to persist derived metrics open.
        licensingStatus: "unverified",
      },
    };

    return json({
      probe: "market-source-probe",
      readOnly: true,
      probedAt: new Date().toISOString(),
      credentialsPresent: credentials,
      providers,
      results,
    });
  } catch (cause) {
    // Never hand a caught error back to the caller: a Postgres message carries
    // table, column and constraint names, and this function holds the
    // service-role key. `internalError` logs the detail against a correlation
    // id and returns only that id.
    return json(internalError(cause, "market-source-probe"), 500);
  }
});
