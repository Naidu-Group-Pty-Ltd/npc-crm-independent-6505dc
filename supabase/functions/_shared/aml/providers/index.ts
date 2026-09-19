/**
 * AML provider orchestration (Phase 6 upgrade).
 *
 * Tri-mode isolation:
 *   - "simulator": deterministic, no external calls (default, safe for tests).
 *   - "live":      real external provider adapters. If a requested provider is
 *                  not wired, the factory THROWS (never silently falls back to
 *                  simulator) so that a live-mode misconfiguration surfaces
 *                  loudly instead of producing a false-pass.
 *
 * Mode is resolved per capability using (in priority order):
 *   1. `provider_configs.mode` for the tenant's active provider (if `admin` client passed).
 *   2. Env override: `AML_PROVIDER_MODE` = "simulator" | "live".
 *   3. Default: "simulator".
 *
 * Providers MUST NEVER be selected client-side. Callers pass a hint only;
 * the shared factory + tenant configuration decide.
 */
import type { IdentityDocumentChoice } from "../identityDocuments.pure.ts";
import { diditExpectedDetails } from "./didit.pure.ts";
import {
  classifyThreshold, readStandaloneThresholds, type ThresholdState,
} from "./diditStandalone.pure.ts";

export type IdvMethod = "document_and_liveness" | "document_only" | "database_lookup" | "manual";

export interface IdvRequest {
  caseId: string;
  subjectLabel: string;
  method: IdvMethod;
  metadata?: Record<string, unknown>;
}

export interface IdvResult {
  provider: string;
  providerReference: string;
  status: "verified" | "failed" | "manual_review" | "pending" | "in_progress";
  overallScore: number;
  checks: Array<{ name: string; status: "pass" | "fail" | "warn"; detail?: string }>;
  raw: Record<string, unknown>;
}

export type ScreeningScope = "pep" | "sanctions" | "adverse_media" | "watchlist";

export interface ScreeningRequest {
  caseId: string;
  subjectLabel: string;
  subjectType: "individual" | "entity" | "trust";
  scope: ScreeningScope[];
  metadata?: Record<string, unknown>;
}

export interface ScreeningMatch {
  matchType: "pep" | "sanctions" | "adverse_media" | "watchlist" | "other";
  listName: string;
  matchedName: string;
  score: number;
  jurisdiction?: string;
  details: Record<string, unknown>;
}

export interface ScreeningResult {
  provider: string;
  providerReference: string;
  status: "clear" | "matched" | "review";
  matches: ScreeningMatch[];
  summary: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface IdvProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  runIdv(req: IdvRequest): Promise<IdvResult>;
}

/**
 * How an IDV provider gets its evidence.
 *
 * `capture` is the original shape and the only one the pipeline had: NPC
 * collects a document photograph and a selfie into its own private buckets,
 * the outbox worker downloads them, and `runIdv()` is a synchronous call with
 * two base64 images in it.
 *
 * `hosted_session` is a genuinely different animal. The provider owns the
 * capture UI, the customer completes it there, and the outcome arrives later on
 * a signed webhook. Forcing that through `runIdv()` would mean NPC downloading
 * a customer's images and posting them to a provider that never asked for them
 * — a second copy of the most sensitive data we hold, moved for no reason.
 *
 * So the two flows are declared rather than blurred, and every caller that
 * cares asks `idvFlowFor()` which one it is dealing with. The worker uses it to
 * stay away from hosted checks; the portal uses it to choose between the camera
 * and the embed.
 */
export type IdvFlow = "capture" | "hosted_session";

export interface HostedIdvSession {
  sessionId: string;
  /**
   * The provider-hosted verification URL for THIS customer.
   *
   * Handed to their browser and never persisted: it embeds their session
   * token, so storing it would put a live credential in the case record.
   */
  url: string;
  status: string;
  workflowId: string | null;
  workflowVersion: number | null;
  expiresAt: string | null;
}

export interface HostedIdvSessionRequest {
  /** Opaque correlation handle. Never a name, email, or document number. */
  vendorData: string;
  /** Internal identifiers only — echoed back on every webhook. */
  metadata: Record<string, unknown>;
  callbackUrl?: string | null;
  /**
   * The document the customer said they would present, in NPC's vocabulary.
   *
   * Deliberately not a provider document code: the adapter translates, so a
   * caller cannot reach the provider's payload by naming one of its enum
   * values. Absent means "not declared" and restricts nothing but the country.
   */
  documentChoice?: IdentityDocumentChoice | null;
  /** Sandbox-only deterministic outcome; ignored by a live application. */
  sandboxScenario?: string | null;
}

export interface HostedIdvProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  readonly flow: "hosted_session";
  /** The workflow NPC configured. Decisions from any other workflow are refused. */
  readonly workflowId: string;
  createSession(req: HostedIdvSessionRequest): Promise<HostedIdvSession>;
  /** Authoritative server-to-server read. Never the webhook body. */
  fetchDecision(sessionId: string): Promise<Record<string, unknown>>;
}

/**
 * A capture-flow provider that examines NPC's own captures over its API.
 *
 * The third shape, and the one the product now uses. It is NOT `IdvProvider`:
 * `runIdv()` is a single synchronous call with two images in it, and a
 * Standalone verification is three separately-billed calls whose sequencing,
 * fail-fast rule and partial results all have to be decided and recorded
 * between them. Squeezing that into `runIdv()` would hide the one property
 * that matters most about it — that each step costs money — inside an
 * adapter that looks free.
 *
 * It is also NOT `HostedIdvProvider`: there is no hosted workflow journey, no
 * hosted URL and no callback, and the customer never leaves NPC. A persisted
 * request can emit `status.updated`, but NPC acknowledges and ignores those —
 * the synchronous response is the authoritative result.
 *
 * The provider object itself is deliberately thin: it holds the credential and
 * the thresholds and exposes the three calls. The composition rule lives in
 * `diditStandalone.pure.ts` and the orchestration in
 * `standaloneVerification.ts`, so neither needs a network to be tested.
 */
export interface StandaloneIdvProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  readonly flow: "capture";
  /** Server-owned decline thresholds. Never client-supplied, never returned. */
  readonly thresholds: { liveness: number; faceMatch: number };
  verifyIdentityDocument(args: {
    frontImage: Uint8Array; backImage?: Uint8Array | null;
    vendorData: string; metadata: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  checkPassiveLiveness(args: {
    userImage: Uint8Array; vendorData: string; metadata: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  compareFaces(args: {
    userImage: Uint8Array; refImage: Uint8Array;
    vendorData: string; metadata: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

export interface ScreeningProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  /**
   * The scopes this provider can actually check. A requested scope outside
   * this list is reported in `summary.scopes_not_covered` and the result can
   * never read as a full clear — an unsupported check is not a passed check.
   */
  readonly supportedScopes: ScreeningScope[];
  runScreening(req: ScreeningRequest): Promise<ScreeningResult>;
}

export type ProviderMode = "simulator" | "live";
export type ProviderCapability = "idv" | "pep_sanctions" | "adverse_media";

// ---------- deterministic simulators ----------

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function pseudoRandom(seed: number, salt: string): number {
  const n = hashSeed(`${seed}|${salt}`);
  return (n % 10_000) / 10_000;
}

const SIMULATOR_IDV: IdvProvider = {
  name: "simulator",
  mode: "simulator",
  async runIdv(req) {
    const seed = hashSeed(`${req.caseId}|${req.subjectLabel}`);
    const scoreBase = pseudoRandom(seed, "idv");
    const overallScore = Math.round((0.6 + scoreBase * 0.4) * 100) / 100;
    const status: IdvResult["status"] =
      overallScore >= 0.85 ? "verified" : overallScore >= 0.70 ? "manual_review" : "failed";
    return {
      provider: "simulator",
      providerReference: `SIM-IDV-${seed.toString(36).slice(0, 10).toUpperCase()}`,
      status,
      overallScore,
      checks: [
        { name: "document_authenticity", status: status === "failed" ? "fail" : "pass" },
        { name: "face_match", status: overallScore >= 0.8 ? "pass" : "warn" },
        { name: "liveness", status: req.method === "document_only" ? "warn" : "pass" },
        { name: "database_crossmatch", status: "pass" },
      ],
      raw: { simulated: true, method: req.method, generated_at: new Date().toISOString() },
    };
  },
};

const KNOWN_LIST_HITS = [
  { pattern: /vladimir|putin/i, list: "OFAC SDN",           type: "sanctions" as const, jur: "US" },
  { pattern: /kim jong/i,       list: "UN Consolidated",    type: "sanctions" as const, jur: "UN" },
  { pattern: /orban|erdogan/i,  list: "PEP Register",       type: "pep" as const,       jur: "EU" },
];

const SIMULATOR_SCREENING: ScreeningProvider = {
  name: "simulator",
  mode: "simulator",
  supportedScopes: ["pep", "sanctions", "adverse_media", "watchlist"],
  async runScreening(req) {
    const seed = hashSeed(`${req.caseId}|${req.subjectLabel}`);
    const matches: ScreeningMatch[] = [];

    for (const rule of KNOWN_LIST_HITS) {
      if (rule.pattern.test(req.subjectLabel) && req.scope.includes(rule.type as ScreeningScope)) {
        matches.push({
          matchType: rule.type,
          listName: rule.list,
          matchedName: req.subjectLabel,
          score: 0.92,
          jurisdiction: rule.jur,
          details: { rule: "keyword", simulated: true },
        });
      }
    }

    if (req.scope.includes("adverse_media") && pseudoRandom(seed, "am") > 0.85) {
      matches.push({
        matchType: "adverse_media",
        listName: "Aggregated News",
        matchedName: req.subjectLabel,
        score: 0.62,
        details: { headline: "Regulatory inquiry (simulated)", simulated: true },
      });
    }

    const status: ScreeningResult["status"] =
      matches.length === 0 ? "clear"
      : matches.some((m) => m.score >= 0.85) ? "matched"
      : "review";

    return {
      provider: "simulator",
      providerReference: `SIM-SCR-${seed.toString(36).slice(0, 10).toUpperCase()}`,
      status,
      matches,
      summary: {
        scope: req.scope,
        match_count: matches.length,
        high_confidence_count: matches.filter((m) => m.score >= 0.85).length,
      },
      raw: { simulated: true, generated_at: new Date().toISOString() },
    };
  },
};

// ---------- zero-cost self-hosted adapters ----------
//
// docs/aml/kyc-zero-cost-solution.md. These two are what make the stack free
// AND lawful: the face models are Apache-2.0 *including weights*, and the
// sanctions data comes from official primary sources rather than an
// aggregator whose data is CC-BY-NC.

/**
 * IDV via the self-hosted verification service (services/aml-verification-service).
 *
 * Returns `manual_review` far more readily than a commercial provider would.
 * That is deliberate: passive liveness here is a heuristic, and the honest
 * response to "probably fine" is a human, not a pass.
 */
/**
 * Per-call ceiling for the verification service.
 *
 * A face compare on a 2000px pair is well under a second; this is generous
 * enough that a cold container still answers, and short enough that three
 * sequential calls stay inside the worker's own budget.
 */
const VERIFICATION_SERVICE_TIMEOUT_MS = Number(
  Deno.env.get("AML_VERIFICATION_SERVICE_TIMEOUT_MS") ?? 20_000,
);

function makeSelfHostedIdvProvider(): IdvProvider {
  const baseUrl = (Deno.env.get("AML_VERIFICATION_SERVICE_URL") || "").replace(/\/+$/, "");
  const token = Deno.env.get("AML_VERIFICATION_SERVICE_TOKEN") || "";

  return {
    name: "selfhosted",
    mode: "live",
    async runIdv(req) {
      if (!baseUrl || !token) {
        // Fail loudly. A misconfigured verification service must never look
        // like a customer who failed verification.
        throw new Error(
          "[aml/providers] selfhosted IDV is active but AML_VERIFICATION_SERVICE_URL / " +
          "AML_VERIFICATION_SERVICE_TOKEN are not set.",
        );
      }

      const meta = (req.metadata ?? {}) as Record<string, string>;
      const documentImage = meta.document_image_b64 ?? "";
      const selfieImage = meta.selfie_image_b64 ?? "";
      if (!documentImage) throw new Error("document image is required for self-hosted IDV");

      /**
       * Strip the service host and bearer token out of anything that will be
       * persisted or logged. `failure_reason` is read by staff and carried
       * into the case record; neither the internal URL nor the credential
       * belongs there, and a transport error quotes the URL by default.
       */
      const redactService = (text: string): string => {
        let out = text;
        if (baseUrl) out = out.split(baseUrl).join("[verification-service]");
        if (token) out = out.split(token).join("[redacted]");
        // Belt and braces: any absolute URL left in a transport message.
        return out.replace(/https?:\/\/[^\s"')]+/gi, "[verification-service]");
      };

      const call = async (path: string, body: Record<string, unknown>) => {
        let res: Response;
        try {
          res = await fetch(`${baseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
            // Without this a hung service hangs the worker until the platform
            // kills it, leaving the check claimed as `processing` with no
            // completion — which used to strand the client permanently.
            signal: AbortSignal.timeout(VERIFICATION_SERVICE_TIMEOUT_MS),
          });
        } catch (e) {
          const aborted = (e as Error)?.name === "TimeoutError" ||
            (e as Error)?.name === "AbortError";
          // The word `timeout` is load-bearing: the consumer categorises on it
          // and records a technical failure, which consumes no attempt.
          throw new Error(aborted
            ? `verification service ${path} timed out after ${VERIFICATION_SERVICE_TIMEOUT_MS}ms`
            // A transport error's message embeds the request URL, and this
            // string is persisted to `failure_reason` and logged. Redact it:
            // the service host is internal configuration and belongs in
            // neither the case record nor the logs.
            : `verification service ${path} unreachable: ${redactService((e as Error)?.message ?? String(e))}`);
        }
        if (!res.ok) {
          // Read the body for the reason but never let it become an identity
          // outcome — a 400 here means we sent something undecodable, a 401
          // means our own token is wrong, a 503 means the models are missing.
          // All three are ours to fix, not the customer's to have failed.
          const detail = await res.text().catch(() => "");
          throw new Error(
            `verification service ${path} returned ${res.status}` +
            (detail ? `: ${redactService(detail).slice(0, 200)}` : ""),
          );
        }
        return await res.json();
      };

      const mrz = await call("/doc/mrz", { document_image: documentImage });

      let face: Record<string, any> | null = null;
      let liveness: Record<string, any> | null = null;
      if (req.method !== "document_only" && selfieImage) {
        face = await call("/face/compare", {
          document_image: documentImage, selfie_image: selfieImage,
        });
        liveness = await call("/face/liveness", { selfie_image: selfieImage });
      }

      const checks: IdvResult["checks"] = [];

      // An unreadable MRZ is NOT a failure: most Australian driver licences
      // carry no ICAO MRZ at all. A FAILED check digit is a different thing.
      if (mrz.found && mrz.valid) {
        checks.push({ name: "mrz_check_digits", status: "pass" });
      } else if (mrz.found && !mrz.valid) {
        checks.push({
          name: "mrz_check_digits", status: "fail",
          detail: (mrz.errors ?? []).join(", "),
        });
      } else {
        checks.push({
          name: "mrz_check_digits", status: "warn",
          detail: "no machine-readable zone found on this document type",
        });
      }

      if (face) {
        checks.push({
          name: "face_match",
          status: face.verdict === "match" ? "pass" : face.verdict === "review" ? "warn" : "fail",
          detail: face.verdict === "unusable"
            ? `capture unusable: ${(face.problems ?? []).join(", ")}`
            : `similarity ${face.similarity} (threshold ${face?.thresholds?.match})`,
        });
      }
      // A liveness signal that failed only because the photo was poor is a
      // capture problem, not a finding. Charging a customer an attempt — and
      // recording an identity failure against them — because their selfie was
      // blurred is exactly the confusion the service's own `problems` list
      // exists to prevent. A screen-replay signal is a different matter and
      // stays a failure.
      let livenessUnusable = false;
      if (liveness) {
        const problems: string[] = Array.isArray(liveness.problems)
          ? liveness.problems.map((p: unknown) => String(p))
          : [];
        const qualityOnly = liveness.is_real === null ||
          problems.includes("no_face_in_selfie") ||
          (problems.length > 0 && problems.every((p) => p === "image_too_blurred"));

        if (qualityOnly) {
          livenessUnusable = true;
          checks.push({
            name: "liveness", status: "warn",
            detail: `capture quality prevented a liveness signal: ${problems.join(", ") || "no face detected"}`,
          });
        } else {
          checks.push({
            name: "liveness",
            status: liveness.is_real === true ? "warn" : "fail",
            // Never "pass": this is a heuristic, and recording it as a pass
            // would overstate what was actually established.
            detail: liveness.advisory ?? "heuristic signal only",
          });
        }
      }

      // Document authenticity is explicitly NOT established: without DVS we
      // never checked the document against its issuing authority.
      checks.push({
        name: "document_authenticity",
        status: "warn",
        detail: "not verified against the issuing authority — no DVS connection",
      });

      const failed = checks.some((c) => c.status === "fail");
      const captureUnusable = face?.verdict === "unusable" || livenessUnusable;

      // Never "verified", even on a match above threshold. Without a check
      // against the issuing authority we have established that a face matches
      // a document, not that the document is genuine — so the strongest honest
      // outcome is a referral to a human. "pending" means we could not look at
      // all, and consumes no attempt.
      const status: IdvResult["status"] =
        captureUnusable ? "pending" : failed ? "failed" : "manual_review";

      const overallScore = typeof face?.similarity === "number"
        ? Math.max(0, Math.min(1, Number(face.similarity)))
        : 0;

      return {
        provider: "selfhosted",
        providerReference: `SELF-${crypto.randomUUID().slice(0, 12).toUpperCase()}`,
        status,
        overallScore,
        checks,
        raw: {
          mrz, face, liveness,
          method: req.method,
          // Carried into the case record so the limitation is never lost.
          limitations: [
            "no_issuing_authority_check",
            "liveness_is_heuristic_only",
          ],
          generated_at: new Date().toISOString(),
        },
      };
    },
  };
}

/**
 * Screening against `aml.sanctions_entries` — our own copy of the official
 * DFAT / UN / OFAC lists.
 *
 * Candidate selection is a cheap token overlap in the database; the actual
 * scoring happens in the shared matcher so it stays unit-testable.
 *
 * This adapter covers SANCTIONS/TFS ONLY. DFAT/UN/OFAC are not a PEP register
 * and not an adverse-media corpus, and this provider never pretends they are:
 * a requested scope it cannot check lands in `summary.scopes_not_covered` and
 * forces the overall status to "review", so the result is structurally unable
 * to read as "PEP clear" or "adverse media clear".
 */

/** What the local list data can actually answer. */
export const LOCAL_LISTS_SUPPORTED_SCOPES: ScreeningScope[] = ["sanctions"];

/**
 * Sanctions data currency limit. The nightly refresh runs daily; 72 hours
 * tolerates a weekend of transient loader failures without ever screening
 * against a list more than three days old. Overridable per tenant through
 * `provider_configs.config.max_list_age_hours` (MLRO-managed), so the freshness
 * policy is reviewable configuration, not a buried constant.
 */
export const DEFAULT_SANCTIONS_MAX_AGE_HOURS = 72;

/**
 * Lists whose currency is REQUIRED before a sanctions result is authoritative.
 * DFAT is the legally operative Australian TFS source: absent, never-loaded or
 * stale DFAT data fails the screening closed (a thrown error — recorded as a
 * technical condition, never as a customer outcome). UN and OFAC remain
 * supplemental: their staleness is reported in the result summary rather than
 * blocking, because entries persist between syncs and screening still runs
 * against the last good copy. Overridable via `config.required_lists`.
 */
export const DEFAULT_REQUIRED_SANCTIONS_LISTS = ["dfat"];

function makeLocalListsScreeningProvider(
  admin: any,
  config?: Record<string, unknown>,
): ScreeningProvider {
  return {
    name: "local_lists",
    mode: "live",
    supportedScopes: LOCAL_LISTS_SUPPORTED_SCOPES,
    async runScreening(req) {
      if (!admin) throw new Error("[aml/providers] local_lists screening requires a service-role client");

      const { normaliseName, screenSubject, DEFAULT_MATCH_THRESHOLD } =
        await import("../matching.ts");

      const threshold = Number(config?.match_threshold ?? DEFAULT_MATCH_THRESHOLD);
      const scopesCovered = req.scope.filter((s) =>
        LOCAL_LISTS_SUPPORTED_SCOPES.includes(s));
      const scopesNotCovered = req.scope.filter((s) =>
        !LOCAL_LISTS_SUPPORTED_SCOPES.includes(s));

      // ── Freshness gate: stale TFS data cannot produce an authoritative
      // result. Checked BEFORE any matching so a stale list is a technical
      // failure (screening incomplete), never "customer clear".
      const maxAgeHours = Number(config?.max_list_age_hours ?? DEFAULT_SANCTIONS_MAX_AGE_HOURS);
      const requiredLists: string[] = Array.isArray(config?.required_lists)
        ? (config!.required_lists as string[]).map((l) => String(l).toLowerCase())
        : DEFAULT_REQUIRED_SANCTIONS_LISTS;

      // Per-list, targeted reads: a batched "recent syncs" window can push a
      // quieter list's latest success out of the window and misreport it.
      // Each list gets its own latest-success and latest-attempt lookup.
      const latestSuccessFor = async (code: string) => {
        const { data, error } = await admin.schema("aml").from("sanctions_list_syncs")
          .select("list_code, status, completed_at, payload_sha256, entry_count")
          .eq("list_code", code).eq("status", "succeeded")
          .order("completed_at", { ascending: false }).limit(1);
        if (error) throw new Error(`sanctions_list_unavailable: could not read sync evidence: ${error.message}`);
        return (data ?? [])[0] ?? null;
      };
      const latestAttemptFor = async (code: string) => {
        const { data, error } = await admin.schema("aml").from("sanctions_list_syncs")
          .select("list_code, status, started_at, completed_at")
          .eq("list_code", code)
          .order("started_at", { ascending: false }).limit(1);
        if (error) throw new Error(`sanctions_list_unavailable: could not read sync evidence: ${error.message}`);
        return (data ?? [])[0] ?? null;
      };

      const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
      const allLists = [...new Set([...requiredLists, "dfat", "un", "ofac"])];
      const listFreshness: Record<string, {
        synced_at: string | null; fresh: boolean; required: boolean;
        latest_attempt_status: string | null;
      }> = {};
      const latestSuccess: Record<string, { completed_at: string; payload_sha256: string | null; entry_count: number }> = {};
      const failures: string[] = [];
      for (const code of allLists) {
        const [success, attempt] = await Promise.all([latestSuccessFor(code), latestAttemptFor(code)]);
        // A "success" that published nothing is not screening data. The
        // loader refuses zero-entry publishes; a zero here means evidence
        // was tampered with or the loader's guard was bypassed.
        const usable = success && success.completed_at && Number(success.entry_count ?? 0) > 0;
        if (usable) {
          latestSuccess[code] = {
            completed_at: String(success.completed_at),
            payload_sha256: success.payload_sha256 ?? null,
            entry_count: Number(success.entry_count ?? 0),
          };
        }
        const fresh = Boolean(usable && new Date(String(success.completed_at)).getTime() >= cutoff);
        const attemptStatus = attempt?.status ? String(attempt.status) : null;
        listFreshness[code] = {
          synced_at: usable ? String(success.completed_at) : null,
          fresh,
          required: requiredLists.includes(code),
          latest_attempt_status: attemptStatus,
        };
        if (!requiredLists.includes(code)) continue;
        // Fail-closed conditions for a REQUIRED list (Australian TFS path):
        // absent / never successfully loaded / stale beyond the limit — and a
        // latest sync attempt that FAILED, even with an in-window success
        // behind it: the list may be missing designations published since.
        if (!usable) failures.push(`${code}: never successfully loaded`);
        else if (!fresh) failures.push(`${code}: last successful sync ${success.completed_at} is older than ${maxAgeHours}h`);
        else if (attemptStatus === "failed") failures.push(`${code}: the latest sync attempt failed`);
      }
      if (failures.length > 0) {
        // The word `sanctions_list_unavailable` is load-bearing: consumers
        // categorise on it and record screening-incomplete, which can never
        // satisfy the AML gate and never reads as a customer outcome.
        throw new Error(
          `sanctions_list_unavailable: ${failures.join("; ")} — screening cannot be ` +
          "authoritative until the sanctions refresh succeeds.",
        );
      }

      // ── Matching. Screen the primary name AND every known alias, merging
      // to the best score per listed entry — an alias hit is the same person.
      const subjectNames = [req.subjectLabel,
        ...(Array.isArray((req.metadata ?? {})["aliases"])
          ? ((req.metadata!["aliases"] as unknown[]).map((a) => String(a)))
          : [])].filter(Boolean);
      const tokens = [...new Set(subjectNames.flatMap((n) => normaliseName(n)))];
      if (tokens.length === 0) {
        // An unscreenable name is not a cleared customer — refer to a human.
        return {
          provider: "local_lists",
          providerReference: `LOCAL-${crypto.randomUUID().slice(0, 12).toUpperCase()}`,
          status: "review", matches: [],
          summary: {
            scope: req.scope, scopes_covered: scopesCovered,
            scopes_not_covered: scopesNotCovered,
            match_count: 0, reason: "no_usable_name_tokens",
            list_freshness: listFreshness,
          },
          raw: { threshold, generated_at: new Date().toISOString() },
        };
      }

      // Overlap on ANY token, then score properly in code. Recall first:
      // requiring all tokens would miss exactly the partial-name cases the
      // matcher exists to catch.
      const { data: rows, error } = await admin.schema("aml").from("sanctions_entries")
        .select("external_id, list_code, primary_name, aliases, date_of_birth, entry_type, listing_reference, listing_detail")
        .overlaps("normalised_names", tokens)
        .limit(2000);
      if (error) throw error;

      const dob = (req.metadata ?? {})["date_of_birth"];
      const candidates = (rows ?? []).map((r: any) => ({
        externalId: String(r.external_id),
        listCode: String(r.list_code),
        primaryName: String(r.primary_name),
        aliases: (r.aliases ?? []) as string[],
        dateOfBirth: r.date_of_birth ?? null,
        entryType: r.entry_type ?? "unknown",
        listingReference: r.listing_reference ?? null,
        detail: r.listing_detail ?? {},
      }));
      const bestByEntry = new Map<string, ReturnType<typeof screenSubject>[number]>();
      for (const name of subjectNames) {
        for (const hit of screenSubject(
          { name, dateOfBirth: typeof dob === "string" ? dob : null },
          candidates, threshold,
        )) {
          const key = `${hit.listCode}:${hit.externalId}`;
          const existing = bestByEntry.get(key);
          if (!existing || hit.score > existing.score) bestByEntry.set(key, hit);
        }
      }
      const hits = [...bestByEntry.values()].sort((a, b) => b.score - a.score);

      const LIST_LABELS: Record<string, string> = {
        dfat: "DFAT Consolidated List (Australia)",
        un: "UN Consolidated List",
        ofac: "OFAC SDN (United States)",
      };

      const matches: ScreeningMatch[] = hits.map((h) => ({
        matchType: "sanctions",
        listName: LIST_LABELS[h.listCode] ?? h.listCode,
        matchedName: h.matchedName,
        score: h.score,
        jurisdiction: h.listCode === "dfat" ? "AU" : h.listCode === "ofac" ? "US" : "UN",
        details: {
          external_id: h.externalId,
          listing_reference: h.listingReference,
          match_basis: h.basis,
          dob_agreement: h.dobAgreement,
          matched_tokens: h.matchedTokens,
          threshold,
        },
      }));

      // Everything above the threshold goes to a human. There is no
      // auto-clear on a match: the point of the low threshold is that a
      // person adjudicates, not that the machine decides. And a request that
      // asked for scopes this data cannot answer (PEP, adverse media,
      // watchlist) can never come back "clear" — only the sanctions portion
      // was checked, and the result says so.
      const status: ScreeningResult["status"] =
        matches.length > 0 ? "review"
        : scopesNotCovered.length > 0 ? "review"
        : "clear";

      return {
        provider: "local_lists",
        providerReference: `LOCAL-${crypto.randomUUID().slice(0, 12).toUpperCase()}`,
        status,
        matches,
        summary: {
          scope: req.scope,
          scopes_covered: scopesCovered,
          scopes_not_covered: scopesNotCovered,
          ...(scopesNotCovered.length > 0
            ? { unsupported_scope_note:
                `local_lists screens official sanctions/TFS lists only — ${scopesNotCovered.join(", ")} ` +
                "was NOT checked and this result must not be read as clearing it." }
            : {}),
          match_count: matches.length,
          candidates_considered: (rows ?? []).length,
          threshold,
          list_freshness: listFreshness,
        },
        raw: {
          threshold,
          lists: [...new Set((rows ?? []).map((r: any) => r.list_code))],
          list_versions: Object.fromEntries(Object.entries(latestSuccess).map(
            ([code, s]) => [code, `${(s.payload_sha256 ?? "unknown").slice(0, 12)}@${s.completed_at}`],
          )),
          generated_at: new Date().toISOString(),
        },
      };
    },
  };
}

// ---------- live adapter stubs (throw until wired) ----------
//
// Real adapters (Frankie, Trulioo, ComplyAdvantage, Refinitiv, Dow Jones…)
// will be added here one by one. Each stub throws a clearly-labelled error so
// that "live" mode never silently falls back to simulator results.

const LIVE_IDV_ADAPTERS: Record<string, (opts: FactoryOptions) => IdvProvider> = {
  // Zero-cost self-hosted stack — see docs/aml/kyc-zero-cost-solution.md.
  "selfhosted": () => makeSelfHostedIdvProvider(),
  // "frankie":       () => makeFrankieIdvProvider(),
  // "trulioo":       () => makeTruliooIdvProvider(),
};

/**
 * Providers that own their own capture UI. Deliberately a SEPARATE registry
 * from `LIVE_IDV_ADAPTERS`: a hosted provider has no `runIdv()`, and putting
 * one in the capture registry would let the outbox worker pick it up and try
 * to post it images.
 */
const HOSTED_IDV_ADAPTERS: Record<string, (opts: FactoryOptions) => HostedIdvProvider> = {
  // Didit — ID Verification + Face Match 1:1 + Passive Liveness.
  // See docs/aml/DIDIT_IDV_INTEGRATION.md.
  //
  // LEGACY. No new attempt is created against this adapter — the portal serves
  // the NPC capture journey and `didit_standalone` below. It stays wired so the
  // sessions already open on 2026-08-08 can still settle through the signed
  // webhook. See docs/aml/DIDIT_STANDALONE_IDV.md.
  "didit": (opts) => makeDiditIdvProvider(opts),
};

/**
 * Capture-flow providers NPC calls with its OWN captures.
 *
 * A third registry, for the third shape. Keeping it out of `LIVE_IDV_ADAPTERS`
 * is what stops the outbox worker's `getIdvProvider()` handing back something
 * with no `runIdv()`, and keeping it out of `HOSTED_IDV_ADAPTERS` is what makes
 * `idvFlowFor()` answer `capture` — which is the one word the portal is told.
 */
const STANDALONE_IDV_ADAPTERS:
Record<string, (opts: FactoryOptions) => StandaloneIdvProvider> = {
  "didit_standalone": (opts) => makeDiditStandaloneProvider(opts),
};

/**
 * Whether an IDV provider key is wired and configured, and which flow it uses.
 *
 * Exported so the staff readiness endpoint asks the registry instead of
 * re-deciding for itself. `aml-verification` used to hardcode
 * `wired = key === "selfhosted"`, which reported a correctly configured Didit
 * as "misconfigured" on the Command Centre card — and, worse, made the
 * "Ask client to verify" request tell the customer to upload a document and
 * skip the selfie while the portal was offering them the photo flow. Two
 * places deciding the same thing is how that happened; there is now one.
 */
export function idvAdapterReadiness(
  providerKey: string | null | undefined,
  resolved?: ResolvedProvider | null,
): { wired: boolean; configured: boolean; flow: IdvFlow } {
  const key = String(providerKey ?? "").toLowerCase();
  return {
    wired: Boolean(LIVE_IDV_ADAPTERS[key]) || Boolean(HOSTED_IDV_ADAPTERS[key])
      || Boolean(STANDALONE_IDV_ADAPTERS[key]),
    configured: adapterConfigured("idv", key, resolved),
    flow: idvFlowFor(key),
  };
}

/** Whether a provider key is the Standalone-API capture shape. */
export function isStandaloneIdvProvider(providerKey: string | null | undefined): boolean {
  return Boolean(STANDALONE_IDV_ADAPTERS[String(providerKey ?? "").toLowerCase()]);
}

/** Which flow a provider key implies. Unknown keys read as `capture`. */
export function idvFlowFor(providerKey: string | null | undefined): IdvFlow {
  return HOSTED_IDV_ADAPTERS[String(providerKey ?? "").toLowerCase()]
    ? "hosted_session"
    : "capture";
}

/**
 * The workflow id NPC will accept decisions from.
 *
 * Tenant provider configuration wins so the workflow can be changed without a
 * deploy, with the environment as the fallback. It is not a secret — it names
 * a workflow, it authorises nothing — but it is still never sent to a browser,
 * because a client that learns it learns which modules NPC runs.
 */
export function diditWorkflowId(resolved?: ResolvedProvider | null): string | null {
  const fromConfig = resolved?.config?.["workflow_id"];
  if (typeof fromConfig === "string" && fromConfig) return fromConfig;
  return Deno.env.get("DIDIT_WORKFLOW_ID") || null;
}

/**
 * When the Didit workflow was last reconfigured, as epoch milliseconds.
 *
 * A hosted session is minted against the workflow as it stood at creation and
 * then lives for seven days, so a customer who started before a change is
 * pinned to the configuration it replaced. The provider's own version number
 * cannot detect it: measured on this account, changing a SETTING left the
 * published workflow at version 1, while editing the GRAPH created version 2 —
 * so equal versions do not mean equal configuration.
 *
 * So the marker is NPC's, set on the provider config by whoever changes the
 * workflow (`config.workflow_revised_at`, an ISO-8601 instant). Absent or
 * unparseable means "never revised" — the guard then does nothing, which is
 * the behaviour that existed before it and cannot strand anybody.
 */
export function workflowRevisedAt(resolved?: ResolvedProvider | null): number | null {
  const raw = resolved?.config?.["workflow_revised_at"];
  if (typeof raw !== "string" || !raw) return null;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? at : null;
}

function makeDiditIdvProvider(opts: FactoryOptions): HostedIdvProvider {
  const apiKey = Deno.env.get("DIDIT_API_KEY") || "";
  const workflowId = diditWorkflowId(opts.resolved) ?? "";

  return {
    name: "didit",
    mode: "live",
    flow: "hosted_session",
    workflowId,
    async createSession(req) {
      if (!apiKey || !workflowId) {
        // Loud, and never a customer outcome. Matches the self-hosted
        // adapter's refusal: a misconfigured provider must not look like a
        // customer who failed verification.
        throw new Error(
          "[aml/providers] didit IDV is active but DIDIT_API_KEY / workflow id are not set.",
        );
      }
      const { createDiditSession } = await import("./diditClient.ts");
      const created = await createDiditSession({
        apiKey, workflowId,
        vendorData: req.vendorData,
        metadata: req.metadata,
        callback: req.callbackUrl ?? null,
        // Only where a callback was supplied; see `CreateSessionArgs`.
        callbackMethod: req.callbackUrl ? "both" : null,
        // NPC's choice, translated here and nowhere else. Australia is applied
        // whether or not a document was declared — the customer is never asked
        // to select a country and must never be shown a picker for one.
        expectedDetails: diditExpectedDetails(req.documentChoice ?? null),
        sandboxScenario: req.sandboxScenario ?? null,
      });
      return created;
    },
    async fetchDecision(sessionId) {
      if (!apiKey) {
        throw new Error("[aml/providers] didit IDV is active but DIDIT_API_KEY is not set.");
      }
      const { fetchDiditDecision } = await import("./diditClient.ts");
      return await fetchDiditDecision(apiKey, sessionId);
    },
  };
}

/**
 * Didit over the Standalone APIs, against NPC's own captures.
 *
 * The credential and BOTH decline thresholds are read from the function
 * environment at construction. That is the point at which a production
 * deployment missing either threshold becomes unusable rather than
 * silently permissive: the Standalone endpoints default to 30, which their own
 * documentation calls permissive, and inheriting that would mean NPC's face
 * match policy was a vendor default nobody chose. Construction throws instead,
 * which the portal turns into "verification is unavailable" — so no customer is
 * ever asked to photograph their face for a provider that could not judge it
 * to NPC's standard.
 */
function makeDiditStandaloneProvider(_opts: FactoryOptions): StandaloneIdvProvider {
  const apiKey = Deno.env.get("DIDIT_API_KEY") || "";
  const thresholds = readStandaloneThresholds((k) => Deno.env.get(k) ?? undefined);

  if (!apiKey || !thresholds) {
    throw new ProviderResolutionError(
      "provider_misconfigured",
      "[aml/providers] didit_standalone is active but DIDIT_API_KEY / "
      + "DIDIT_LIVENESS_THRESHOLD / DIDIT_FACE_MATCH_THRESHOLD are missing or "
      + "outside 0-100.",
    );
  }

  const metadataFor = (extra: Record<string, unknown>) => extra;

  return {
    name: "didit_standalone",
    mode: "live",
    flow: "capture",
    thresholds,
    async verifyIdentityDocument(args) {
      const { verifyIdentityDocument } = await import("./diditStandaloneClient.ts");
      const { body } = await verifyIdentityDocument({
        apiKey,
        frontImage: args.frontImage,
        backImage: args.backImage ?? null,
        vendorData: args.vendorData,
        metadata: metadataFor(args.metadata),
      });
      return body;
    },
    async checkPassiveLiveness(args) {
      const { checkPassiveLiveness } = await import("./diditStandaloneClient.ts");
      const { body } = await checkPassiveLiveness({
        apiKey,
        userImage: args.userImage,
        // Server configuration, applied here. There is no parameter on any
        // portal operation through which a browser could reach it.
        declineThreshold: thresholds.liveness,
        vendorData: args.vendorData,
        metadata: metadataFor(args.metadata),
      });
      return body;
    },
    async compareFaces(args) {
      const { compareFaces } = await import("./diditStandaloneClient.ts");
      const { body } = await compareFaces({
        apiKey,
        userImage: args.userImage,
        refImage: args.refImage,
        declineThreshold: thresholds.faceMatch,
        vendorData: args.vendorData,
        metadata: metadataFor(args.metadata),
      });
      return body;
    },
  };
}

const LIVE_SCREENING_ADAPTERS: Record<string, (opts: FactoryOptions) => ScreeningProvider> = {
  // Screening against lists we hold, downloaded from official primary sources.
  "local_lists": (opts) => makeLocalListsScreeningProvider(opts.admin, opts.resolved?.config),
  // "complyadvantage": () => makeComplyAdvantageProvider(),
  // "refinitiv":       () => makeRefinitivProvider(),
  // "dowjones":        () => makeDowJonesProvider(),
};

// ---------- resolver + factory ----------

export interface ResolvedProvider {
  providerKey: string;
  mode: ProviderMode;
  configId: string | null;
  config: Record<string, unknown>;
  costCents: number;
}

/**
 * Resolve the tenant's highest-priority active provider for a capability.
 * Returns null if the tenant has no configured provider (caller falls back
 * to env / simulator default).
 */
export async function resolveTenantProvider(
  admin: any,
  tenantId: string,
  capability: ProviderCapability,
): Promise<ResolvedProvider | null> {
  if (!admin) return null;
  try {
    const { data } = await admin.schema("aml").from("provider_configs")
      .select("id, provider_key, mode, config, cost_per_unit_cents, priority, active")
      .eq("tenant_id", tenantId)
      .eq("capability", capability)
      .eq("active", true)
      .order("priority", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return {
      providerKey: String(data.provider_key),
      mode: (data.mode === "live" ? "live" : "simulator") as ProviderMode,
      configId: data.id ?? null,
      config: (data.config ?? {}) as Record<string, unknown>,
      costCents: Number(data.cost_per_unit_cents ?? 0),
    };
  } catch (e) {
    console.warn("[aml/providers] resolveTenantProvider failed", (e as Error)?.message);
    return null;
  }
}

function envMode(): ProviderMode {
  const v = (Deno.env.get("AML_PROVIDER_MODE") || "").toLowerCase();
  return v === "live" ? "live" : "simulator";
}

import {
  classifyEnvironment,
  decideProvider,
  ProviderResolutionError,
  technicalCategoryForRefusal,
  type AmlEnvironment,
  type ProviderDecision,
} from "../providerEnvironment.ts";

export { ProviderResolutionError, technicalCategoryForRefusal };

export function currentEnvironment(): AmlEnvironment {
  return classifyEnvironment({
    amlEnvironment: Deno.env.get("AML_ENVIRONMENT"),
    supabaseUrl: Deno.env.get("SUPABASE_URL"),
  });
}

function selfHostedIdvConfigured(): boolean {
  return Boolean(Deno.env.get("AML_VERIFICATION_SERVICE_URL")) &&
    Boolean(Deno.env.get("AML_VERIFICATION_SERVICE_TOKEN"));
}

// ---------- live health of the self-hosted service ----------

export interface SelfHostedHealth {
  /** The service answered. */
  reachable: boolean;
  /** `ok` only when both models initialise — see the service's /healthz. */
  status: string | null;
  /** Safe, non-identifying reason. Never the URL or the token. */
  detail: string | null;
}

/**
 * Probe `GET /healthz` on the verification service.
 *
 * Readiness used to be computed from secret presence alone, and said as much
 * in its own note: "not a claim that any provider call has been made". Two
 * secrets pointing at a dead container reported `ready_live`, so staff saw a
 * ready provider and clients were offered a camera whose capture could never
 * be examined — a face collected with no purpose that could be served (APP 3).
 *
 * `/healthz` is unauthenticated by design, so this needs no token and cannot
 * leak one. The probe is short: readiness is an interactive screen.
 */
export async function checkSelfHostedIdvHealth(): Promise<SelfHostedHealth> {
  const baseUrl = (Deno.env.get("AML_VERIFICATION_SERVICE_URL") || "").replace(/\/+$/, "");
  if (!baseUrl) return { reachable: false, status: null, detail: "service_url_not_set" };

  try {
    const res = await fetch(`${baseUrl}/healthz`, {
      method: "GET",
      signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { reachable: true, status: null, detail: `healthz_http_${res.status}` };
    }
    const body = await res.json().catch(() => null) as
      { status?: string; models?: Record<string, boolean>; token_configured?: boolean } | null;
    if (!body) return { reachable: true, status: null, detail: "healthz_unparseable" };

    const unusable = Object.entries(body.models ?? {})
      .filter(([, usable]) => !usable).map(([name]) => name);
    return {
      reachable: true,
      status: body.status ?? null,
      detail: body.status === "ok"
        ? null
        : unusable.length
          ? `models_unusable: ${unusable.join(", ")}`
          : body.token_configured === false
            ? "service_token_not_configured"
            : `status_${body.status ?? "unknown"}`,
    };
  } catch (e) {
    const timedOut = (e as Error)?.name === "TimeoutError" ||
      (e as Error)?.name === "AbortError";
    // Never echo the transport message: it embeds the service URL.
    return { reachable: false, status: null, detail: timedOut ? "healthz_timeout" : "healthz_unreachable" };
  }
}

/** Short cache so a per-request readiness check is not a per-request round trip. */
const HEALTH_PROBE_TIMEOUT_MS = 5_000;
const HEALTH_CACHE_MS = 30_000;
let healthCache: { at: number; value: SelfHostedHealth } | null = null;

/** Cached probe, for paths that run on every client page load. */
export async function cachedSelfHostedIdvHealth(): Promise<SelfHostedHealth> {
  const now = Date.now();
  if (healthCache && now - healthCache.at < HEALTH_CACHE_MS) return healthCache.value;
  const value = await checkSelfHostedIdvHealth();
  healthCache = { at: now, value };
  return value;
}

/**
 * Didit needs three things, and the webhook secret is one of them.
 *
 * Without it no decision can ever be accepted, so a deployment holding only
 * the API key would happily create (chargeable) sessions whose results NPC
 * could never receive — every customer stranded mid-flow. "Configured" has to
 * mean the whole round trip, not just the outbound half.
 */
function diditIdvConfigured(resolved?: ResolvedProvider | null): boolean {
  return Boolean(Deno.env.get("DIDIT_API_KEY"))
    && Boolean(Deno.env.get("DIDIT_WEBHOOK_SECRET"))
    && Boolean(diditWorkflowId(resolved));
}

/**
 * Whether the Standalone path can run.
 *
 * Notice what is NOT here. `DIDIT_WORKFLOW_ID` is absent because there is no
 * workflow — the three endpoints are called directly. `DIDIT_WEBHOOK_SECRET` is
 * absent because these endpoints answer synchronously and that response IS the
 * authoritative result. A persisted request (`save_api_request=true`) does emit
 * `status.updated`, but NPC deliberately ignores those — settling from one
 * would be a second authoritative path racing the response already composed —
 * so the secret is not what makes this path usable. Requiring either would
 * refuse a correctly configured deployment.
 *
 * Both thresholds ARE required, and that is the deliberate half: a production
 * deployment that has not stated its liveness and face-match policy is not
 * ready to collect a biometric, because nothing could judge it against a
 * standard NPC chose.
 */
function diditStandaloneConfigured(): boolean {
  return standaloneIdvReadiness().ready;
}

/**
 * Why the Standalone provider is or is not ready — for STAFF, never a customer.
 *
 * `configured` is one boolean and it has to be, because the portal's answer is
 * one word. An operator's answer cannot be: "misconfigured" leaves them
 * guessing between a credential nobody set, a threshold nobody set, and a
 * threshold somebody set to `0.6` on a 0–100 scale. Those are three different
 * mistakes with three different fixes, and the Command Centre is where they get
 * fixed.
 *
 * Reports PRESENCE and VALIDITY only. No value of any secret or threshold
 * crosses this boundary — the caller renders booleans and state words.
 */
export interface StandaloneIdvReadiness {
  api_key_present: boolean;
  liveness_threshold: ThresholdState;
  face_match_threshold: ThresholdState;
  /**
   * How this deployment reaches the vendor.
   *
   * `direct` holds the Didit key itself — the prime, which IS the account
   * holder. `broker` holds none and calls through Mission Control, which is
   * the ordinary state of a tenant: a Didit key can list every session in its
   * application, so forwarding one would let each tenant read the others'
   * customers' passport portraits. `none` can verify by neither route.
   */
  credential: "direct" | "broker" | "none";
  ready: boolean;
}

export function standaloneIdvReadiness(): StandaloneIdvReadiness {
  const apiKeyPresent = Boolean(Deno.env.get("DIDIT_API_KEY"));
  /*
   * A tenant deliberately holds no Didit key, so "no key" must not mean "not
   * ready" — it means "reaches the vendor the other way". Readiness is a
   * question about whether a verification can RUN, and both routes can run
   * one. Requiring the key here is what would leave every brokered clone
   * reporting itself unconfigured while working perfectly.
   */
  const brokerReachable = Boolean(Deno.env.get("MISSION_CONTROL_URL"))
    && Boolean(Deno.env.get("MISSION_CONTROL_CLONE_API_KEY"));
  const credential: StandaloneIdvReadiness["credential"] = apiKeyPresent
    ? "direct"
    : brokerReachable
    ? "broker"
    : "none";
  const liveness = classifyThreshold(Deno.env.get("DIDIT_LIVENESS_THRESHOLD"));
  const faceMatch = classifyThreshold(Deno.env.get("DIDIT_FACE_MATCH_THRESHOLD"));
  return {
    api_key_present: apiKeyPresent,
    liveness_threshold: liveness,
    face_match_threshold: faceMatch,
    credential,
    // The thresholds are still required on BOTH routes: they are this
    // deployment's own policy, not the vendor's, and the broker neither
    // supplies nor overrides them.
    ready: credential !== "none" && liveness === "ok" && faceMatch === "ok",
  };
}

function adapterConfigured(
  capability: "idv" | "screening", key: string, resolved?: ResolvedProvider | null,
): boolean {
  if (capability === "idv" && key === "selfhosted") return selfHostedIdvConfigured();
  if (capability === "idv" && key === "didit") return diditIdvConfigured(resolved);
  if (capability === "idv" && key === "didit_standalone") return diditStandaloneConfigured();
  // Adapters without external configuration (e.g. local_lists screening)
  // count as configured once wired.
  return true;
}

export interface FactoryOptions {
  /** Tenant-resolved provider (see `resolveTenantProvider`). */
  resolved?: ResolvedProvider | null;
  /** Free-form hint from caller; only used when no tenant config exists. */
  preferred?: string;
  /**
   * Service-role client. Required by adapters that read data we host
   * ourselves — the local sanctions lists in particular.
   */
  admin?: any;
}

/**
 * Shared resolution for both IDV flows, so the wiring/configuration policy is
 * applied once rather than once per factory.
 */
function decideIdv(opts: FactoryOptions): { decision: ProviderDecision; key: string } {
  const mode: ProviderMode = opts.resolved?.mode ?? envMode();
  const key = (opts.resolved?.providerKey || opts.preferred || "simulator").toLowerCase();

  return {
    key,
    decision: decideProvider({
      environment: currentEnvironment(),
      mode,
      providerKey: key,
      // Any of the three registries counts as wired. Without this a Didit
      // tenant config would be refused as "no adapter wired" even though one
      // exists.
      adapterWired: Boolean(LIVE_IDV_ADAPTERS[key]) || Boolean(HOSTED_IDV_ADAPTERS[key])
        || Boolean(STANDALONE_IDV_ADAPTERS[key]),
      adapterConfigured: adapterConfigured("idv", key, opts.resolved),
    }),
  };
}

/**
 * The capture-flow IDV provider (self-hosted today, simulator off-production).
 *
 * Refuses a hosted provider outright rather than returning something with no
 * `runIdv()`. That refusal is load-bearing: the outbox worker calls this, and
 * a Didit check reaching it would try to download NPC captures that do not
 * exist and record `storage_unreadable:document` — a technical failure against
 * a customer whose verification was never NPC's to run.
 */
export function getIdvProvider(opts: FactoryOptions = {}): IdvProvider {
  const { decision, key } = decideIdv(opts);
  if (decision.kind === "refuse") {
    // Fail closed and typed: production never falls back to the simulator,
    // and a misconfiguration is never allowed to look like a customer who
    // failed verification. Callers map the code to a safe response.
    throw new ProviderResolutionError(decision.code, `[aml/providers] ${decision.message}`);
  }
  if (decision.kind === "simulator") return SIMULATOR_IDV;
  if (HOSTED_IDV_ADAPTERS[key]) {
    throw new ProviderResolutionError(
      "provider_misconfigured",
      `[aml/providers] "${key}" is a hosted-session provider and has no capture-mode ` +
      "runIdv(). Use getHostedIdvProvider(); the customer completes capture on the " +
      "provider's own UI and the outcome arrives by signed webhook.",
    );
  }
  if (STANDALONE_IDV_ADAPTERS[key]) {
    // Same lock, opposite shape. A Standalone provider runs three separately
    // billed calls with a fail-fast rule between them, which `runIdv()` cannot
    // express — a caller that reached it here would either lose the sequencing
    // or pay for steps the previous one had already ruled out.
    throw new ProviderResolutionError(
      "provider_misconfigured",
      `[aml/providers] "${key}" is a Standalone-API provider and has no single-call ` +
      "runIdv(). Use getStandaloneIdvProvider() via standaloneVerification.ts.",
    );
  }
  return LIVE_IDV_ADAPTERS[key](opts);
}

/**
 * The Standalone-API capture provider.
 *
 * Throws rather than degrading, exactly like the other two factories: a caller
 * that expected three billed calls against NPC's captures must never quietly
 * receive the simulator, the self-hosted adapter, or a hosted session.
 */
export function getStandaloneIdvProvider(opts: FactoryOptions = {}): StandaloneIdvProvider {
  const { decision, key } = decideIdv(opts);
  if (decision.kind === "refuse") {
    throw new ProviderResolutionError(decision.code, `[aml/providers] ${decision.message}`);
  }
  if (!STANDALONE_IDV_ADAPTERS[key]) {
    throw new ProviderResolutionError(
      "provider_misconfigured",
      `[aml/providers] "${key}" is not a Standalone-API IDV provider.`,
    );
  }
  return STANDALONE_IDV_ADAPTERS[key](opts);
}

/**
 * The hosted-session IDV provider. Throws unless the resolved provider really
 * is one, so a caller can never quietly get the simulator or the self-hosted
 * adapter where it expected a session.
 */
export function getHostedIdvProvider(opts: FactoryOptions = {}): HostedIdvProvider {
  const { decision, key } = decideIdv(opts);
  if (decision.kind === "refuse") {
    throw new ProviderResolutionError(decision.code, `[aml/providers] ${decision.message}`);
  }
  if (!HOSTED_IDV_ADAPTERS[key]) {
    throw new ProviderResolutionError(
      "provider_misconfigured",
      `[aml/providers] "${key}" is not a hosted-session IDV provider.`,
    );
  }
  return HOSTED_IDV_ADAPTERS[key](opts);
}

/**
 * The flow the tenant's configured IDV provider implies, resolved server-side.
 *
 * The browser never supplies this and never learns the provider key — it is
 * told only which of the two experiences to render.
 */
export async function resolveIdvFlow(
  admin: any, tenantId = "default",
): Promise<{ flow: IdvFlow; providerKey: string; resolved: ResolvedProvider | null }> {
  const resolved = await resolveTenantProvider(admin, tenantId, "idv");
  const providerKey = (resolved?.providerKey ?? "simulator").toLowerCase();
  return { flow: idvFlowFor(providerKey), providerKey, resolved };
}

export function getScreeningProvider(opts: FactoryOptions = {}): ScreeningProvider {
  const mode: ProviderMode = opts.resolved?.mode ?? envMode();
  const key = (opts.resolved?.providerKey || opts.preferred || "simulator").toLowerCase();

  const decision = decideProvider({
    environment: currentEnvironment(),
    mode,
    providerKey: key,
    adapterWired: Boolean(LIVE_SCREENING_ADAPTERS[key]),
    adapterConfigured: adapterConfigured("screening", key),
  });
  if (decision.kind === "refuse") {
    throw new ProviderResolutionError(decision.code, `[aml/providers] ${decision.message}`);
  }
  if (decision.kind === "simulator") return SIMULATOR_SCREENING;
  return LIVE_SCREENING_ADAPTERS[key](opts);
}

/** Adverse media resolves to the same screening adapter, restricted to that scope. */
export function getAdverseMediaProvider(opts: FactoryOptions = {}): ScreeningProvider {
  return getScreeningProvider(opts);
}

// ---------- metrics helper ----------

/**
 * Wrap a provider call, recording latency + success/failure + cost into
 * `aml.provider_metrics_daily`. Metrics failures never break the call.
 */
export async function runWithMetrics<T>(
  admin: any,
  args: {
    tenantId: string;
    capability: ProviderCapability;
    providerKey: string;
    costCents?: number;
    configId?: string | null;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  let failed = 0;
  try {
    const out = await fn();
    return out;
  } catch (e) {
    failed = 1;
    if (admin && args.configId) {
      await admin.schema("aml").from("provider_configs").update({
        last_health_at: new Date().toISOString(),
        last_health_status: "failing",
        last_health_message: (e as Error)?.message?.slice(0, 240) ?? "provider_failure",
      }).eq("id", args.configId).then(() => {}, () => {});
    }
    throw e;
  } finally {
    const latency = Date.now() - started;
    try {
      if (admin) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: existing } = await admin.schema("aml").from("provider_metrics_daily")
        .select("id, call_count, failure_count, latency_ms_sum, cost_cents_sum")
        .eq("tenant_id", args.tenantId)
        .eq("capability", args.capability)
        .eq("provider_key", args.providerKey)
        .eq("metric_date", today)
        .maybeSingle();
      if (existing) {
        await admin.schema("aml").from("provider_metrics_daily").update({
          call_count: (existing.call_count ?? 0) + 1,
          failure_count: (existing.failure_count ?? 0) + failed,
          latency_ms_sum: Number(existing.latency_ms_sum ?? 0) + latency,
          cost_cents_sum: Number(existing.cost_cents_sum ?? 0) + (failed ? 0 : Number(args.costCents ?? 0)),
        }).eq("id", existing.id);
      } else {
        await admin.schema("aml").from("provider_metrics_daily").insert({
          tenant_id: args.tenantId,
          capability: args.capability,
          provider_key: args.providerKey,
          metric_date: today,
          call_count: 1,
          failure_count: failed,
          latency_ms_sum: latency,
          cost_cents_sum: failed ? 0 : Number(args.costCents ?? 0),
        });
      }
      }
    } catch (metricErr) {
      console.warn("[aml/providers] metric recording failed", (metricErr as Error)?.message);
    }
  }
}

// ---------- webhook signature verification ----------

export async function verifyWebhookSignature(
  rawBody: string,
  signatureHex: string,
  secret: string,
): Promise<boolean> {
  if (!signatureHex || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(macBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (expected.length !== signatureHex.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signatureHex.charCodeAt(i);
  }
  return diff === 0;
}
