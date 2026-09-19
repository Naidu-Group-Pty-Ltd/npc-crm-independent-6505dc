import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  perimeterIsClassified, resolveScreeningNextAction,
} from "./screeningNextAction";
import { deriveScreeningNextAction } from "../../../supabase/functions/_shared/aml/screeningPolicy.pure.ts";

/**
 * An unclassified case must never be sent to AML Configuration.
 *
 * The server learned to ask for a perimeter classification before demanding
 * a provider repair — but the server and the browser deploy on different
 * schedules. Measured on 2026-08-18, `aml-cases` in production was v73
 * (12:17 UTC) while that logic had merged at 13:37 and 14:1x and had not
 * shipped: the deployed bundle contained no `perimeterClassified`, no
 * `classify_perimeter` and no `classified` field, so it answered
 * `fix_provider` for an undecided case exactly as it always had. The
 * operator followed it to `/admin/aml/configuration`, where the step-up
 * dialog correctly stopped them — from doing work nobody had established
 * was needed.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

// Kept as a plain record rather than `as never`: the fixture is spread below,
// and nothing can be spread from `never`. Each call site casts instead.
const FIX = {
  key: "fix_provider", label: "Open screening configuration",
  headline: "Screening cannot run yet",
  detail: "The screening provider and its sanctions data must be restored.",
  owner: "administrator",
} as Record<string, unknown>;

const OUTSIDE = {
  classification: "outside_perimeter" as const, classified: true,
  reason_code: "enquiry_only", scopes_excluded: ["sanctions" as const],
  recorded_by_label: "mlro@npcservices.com.au",
  recorded_at: "2026-08-18T00:00:00.000Z",
};
const INSIDE_RECORDED = {
  classification: "designated_service" as const, classified: true,
  reason_code: null, scopes_excluded: [],
  recorded_by_label: "reviewer@npcservices.com.au",
  recorded_at: "2026-08-18T00:00:00.000Z",
};

describe("4, 14, 16. a stale fix_provider never reaches configuration", () => {
  it("converts it to classify_perimeter when nobody has decided", () => {
    const a = resolveScreeningNextAction(FIX as never, null)!;
    expect(a.key).toBe("classify_perimeter");
    expect(a.label).toBe("Classify sanctions screening requirement");
    expect(a.detail).toMatch(/before changing screening configuration/i);
    expect(a.owner).toBe("reviewer");
    expect(a.label).not.toMatch(/open screening configuration/i);
  });

  it("handles the OLD response shape, which has no `classified` at all", () => {
    // This is the deployed v73 shape: a perimeter object with no `classified`
    // key, or no perimeter at all.
    for (const perimeter of [
      undefined, null,
      { classification: "designated_service", reason_code: null,
        scopes_excluded: [], recorded_by_label: null, recorded_at: null },
    ] as never[]) {
      expect(resolveScreeningNextAction(FIX as never, perimeter)!.key).toBe("classify_perimeter");
    }
  });

  it("17. leaves it alone once INSIDE is explicitly recorded", () => {
    expect(resolveScreeningNextAction(FIX as never, INSIDE_RECORDED as never)).toBe(FIX);
    expect(resolveScreeningNextAction(FIX as never, {
      ...INSIDE_RECORDED, classified: undefined,
    } as never)).toBe(FIX);
  });

  it("leaves it alone for a recorded outside finding", () => {
    expect(resolveScreeningNextAction(FIX as never, OUTSIDE as never)).toBe(FIX);
  });

  it("touches no other action", () => {
    for (const key of [
      "none", "await_submission", "enrol_subjects", "run_screening",
      "adjudicate_match", "record_pep", "await_provider_result",
      "screening_stalled", "escalate", "classify_perimeter",
    ]) {
      const action = { ...FIX, key } as never;
      expect(resolveScreeningNextAction(action, null)).toBe(action);
    }
  });

  it("survives a null action", () => {
    expect(resolveScreeningNextAction(null, null)).toBeNull();
  });
});

describe("5, 18. the guard changes the ASK, never the truth", () => {
  it("reads no scope, requirement or outcome — it cannot change one", () => {
    /*
     * Asserted on what the function READS, not on words it contains — its
     * own copy legitimately says "sanctions screening is required", which is
     * the sentence an operator needs and not a data access.
     */
    const src = read("src/lib/aml/screeningNextAction.ts");
    const fn = src.slice(src.indexOf("export function resolveScreeningNextAction"));
    const body = fn.slice(0, fn.indexOf("return {"));
    for (const forbidden of [
      "\\.required", "\\.state", "\\.scopes", "\\.provider_ready",
      "\\.subjects", "\\.policy", "\\.sanctions",
    ]) {
      expect(body).not.toMatch(new RegExp(forbidden));
    }
    // The only two things it reads.
    expect(body).toMatch(/action\.key/);
    expect(body).toMatch(/perimeterIsClassified\(perimeter\)/);
  });

  it("never infers an exemption from missing data", () => {
    // Unknown perimeter asks for a decision. It never answers one.
    expect(perimeterIsClassified(null)).toBe(false);
    expect(perimeterIsClassified(undefined)).toBe(false);
    expect(perimeterIsClassified({} as never)).toBe(false);
    const a = resolveScreeningNextAction(FIX as never, null)!;
    expect(a.key).toBe("classify_perimeter");
    expect(JSON.stringify(a)).not.toMatch(/not_required|exempt|clear/i);
  });

  it("a bare designated_service with no timestamp is the DEFAULT, not a decision", () => {
    expect(perimeterIsClassified({
      classification: "designated_service", reason_code: null, scopes_excluded: [],
      recorded_by_label: null, recorded_at: null,
    } as never)).toBe(false);
  });

  it("prefers the canonical flag when the server sends it", () => {
    // An explicit false wins over any shape-based guess.
    expect(perimeterIsClassified({ ...OUTSIDE, classified: false } as never)).toBe(false);
    expect(perimeterIsClassified({ ...INSIDE_RECORDED, classified: true } as never)).toBe(true);
  });
});

describe("1-3, 6, 10. the server's own priority, on a current backend", () => {
  const base = {
    hasSubmission: true, subjectCount: 1, anyUnscreened: true,
    anyProcessing: false, anyPossibleMatch: false, anyConfirmedMatch: false,
    anyMissingPep: true, pepRoute: "manual_review" as const,
  };

  it("1. unclassified + provider down → classify_perimeter", () => {
    expect(deriveScreeningNextAction({
      ...base, providerReady: false, perimeterClassified: false,
    }).key).toBe("classify_perimeter");
  });

  it("2. unclassified + DFAT missing → classify_perimeter", () => {
    expect(deriveScreeningNextAction({
      ...base, providerReady: false, perimeterClassified: false,
      errorCategory: "list_data_unavailable",
    }).key).toBe("classify_perimeter");
  });

  it("3. unclassified + an existing provider_misconfigured → classify_perimeter", () => {
    expect(deriveScreeningNextAction({
      ...base, providerReady: true, anyUnscreened: false,
      perimeterClassified: false, errorCategory: "provider_misconfigured",
    }).key).toBe("classify_perimeter");
  });

  it("6. explicitly inside + provider down → fix_provider", () => {
    const a = deriveScreeningNextAction({
      ...base, providerReady: false, perimeterClassified: true,
    });
    expect(a.key).toBe("fix_provider");
    expect(a.label).toMatch(/open screening configuration/i);
  });

  it("10. a match still outranks the question", () => {
    expect(deriveScreeningNextAction({
      ...base, providerReady: false, perimeterClassified: false, anyPossibleMatch: true,
    }).key).toBe("adjudicate_match");
    expect(deriveScreeningNextAction({
      ...base, providerReady: false, perimeterClassified: false, anyConfirmedMatch: true,
    }).key).toBe("escalate");
  });
});

describe("15, 20. nothing about security moved", () => {
  it("the guard is applied in the hook, and touches no auth surface", () => {
    const hook = read("src/lib/aml/useScreeningStage.ts");
    expect(hook).toMatch(/resolveScreeningNextAction\(/);
    // Applied in exactly ONE place, so the card and the workspace handler
    // cannot disagree about which action is offered.
    expect([...hook.matchAll(/resolveScreeningNextAction\(/g)]).toHaveLength(1);
    // Comments stripped first: the module's own header explains the step-up
    // dialog it must NOT interfere with, and naming a thing is not touching it.
    const code = (src: string) => src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    for (const f of [
      "src/lib/aml/screeningNextAction.ts",
      "src/lib/aml/useScreeningStage.ts",
    ]) {
      expect(code(read(f)))
        .not.toMatch(/step[_-]?up|stepUp|reauth|session_token|custom_users/i);
    }
  });

  it("the configuration route itself is unchanged", () => {
    // The step-up dialog on that page is correct and stays. The fix is that
    // an undecided case is not sent there, not that the page got easier.
    expect(read("src/lib/aml/amlRoutes.ts"))
      .toMatch(/ADMIN_AML_CONFIGURATION_PATH = "\/admin\/aml\/configuration"/);
  });
});
