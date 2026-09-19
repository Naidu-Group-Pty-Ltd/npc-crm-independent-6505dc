import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PASSPORT_STATE_REASONS, derivePassportState, refreshRemedy,
} from "./index";

/**
 * "Refresh required" is one code covering two different owed acts.
 *
 * ── What was measured, on a real case ─────────────────────────────────
 * `AML-2026-00005`: attestation v1, issued, not superseded,
 * `refresh_required_at` NULL, zero rows in `partner_refresh_obligations`.
 * The Passport read **"Refresh required · v1"** for exactly one reason —
 * `service_gate_regressed` — because `service_gate_status` was
 * `under_review`.
 *
 * Nothing about the document was wrong. But Stage 9 said "a newer version
 * is needed", and the reliance panel opened "Issue the attestation" with a
 * "Reissue as v2" button. Following that supersedes a good v1 and leaves
 * the state exactly where it was, because v2 carries the same reason while
 * the gate is unapproved.
 *
 * The rule: **a remedy that cannot discharge the reason is never offered
 * as the next step.** This module is the one place that knows which act
 * clears which reason.
 */

describe("what would actually clear the state", () => {
  it("a gate reason is cleared by the GATE, never by a version", () => {
    expect(refreshRemedy(["service_gate_regressed"])).toBe("approve_gate");
  });

  it("a document reason is cleared by a version", () => {
    expect(refreshRemedy(["material_inputs_changed"])).toBe("reissue");
    expect(refreshRemedy(["open_refresh_obligation"])).toBe("reissue");
    expect(refreshRemedy(["all_versions_superseded"])).toBe("reissue");
  });

  it("both together is BOTH — the version is still owed", () => {
    expect(refreshRemedy(["service_gate_regressed", "open_refresh_obligation"]))
      .toBe("both");
  });

  it("nothing owed reads as nothing owed", () => {
    expect(refreshRemedy([])).toBe("none");
    expect(refreshRemedy(null)).toBe("none");
    expect(refreshRemedy(undefined)).toBe("none");
  });

  it("a HEALTHY reading owes nothing — it is not an unrecognised caution", () => {
    /* `issued_current` publishes `current_attestation_gate_approved`, and a
       caller may hand this function any state's reasons. Defaulting it into
       "reissue" would tell an operator to supersede a Passport that is
       working. Restrictions are the same: a locked or terminated gate is the
       MLRO's own standing decision, not a debt a version discharges. */
    expect(refreshRemedy(["current_attestation_gate_approved"])).toBe("none");
    expect(refreshRemedy(["no_attestation"])).toBe("none");
    expect(refreshRemedy(["service_gate_terminated"])).toBe("none");
    expect(refreshRemedy(["service_gate_locked"])).toBe("none");
    expect(refreshRemedy(["case_closed"])).toBe("none");
  });

  it("an UNRECOGNISED reason counts towards the reissue, not the gate", () => {
    /* The conservative side. Offering a reissue that turns out to be
       unnecessary costs a version; withholding one that IS needed strands
       the case. The exhaustiveness test below is what keeps an
       unrecognised reason from reaching production at all. */
    expect(refreshRemedy(["something_new"])).toBe("reissue");
    expect(refreshRemedy(["something_new", "service_gate_regressed"])).toBe("both");
  });
});

describe("no reason may go unclassified", () => {
  it("every reason the deriver can emit is classified", () => {
    /* A new reason must be classified deliberately. Without this, adding
       another gate-shaped reason silently defaults into "reissue" and
       reopens exactly the loop this module exists to close. */
    const source = readFileSync(
      "supabase/functions/_shared/aml/passport/passportState.pure.ts", "utf8");
    const emitted = new Set(
      [...source.matchAll(/reasons\.push\("([a-z_]+)"\)/g)].map((m) => m[1]),
    );
    for (const m of source.matchAll(/result\(\s*"[a-z_]+",\s*\[\s*"([a-z_]+)"\s*\]/g)) {
      emitted.add(m[1]);
    }
    expect(emitted.size).toBeGreaterThan(3);

    const classified = new Set<string>(PASSPORT_STATE_REASONS);
    for (const reason of emitted) {
      expect(classified.has(reason), `unclassified reason: ${reason}`).toBe(true);
    }
  });
});

describe("the reported case, end to end", () => {
  const attestation = {
    version: 1,
    issued_at: "2026-08-27T08:28:28.588Z",
    superseded_at: null,
    payload_sha256: "2809a9e048b1397",
    schema_version: 1,
  };

  it("an unapproved gate alone flags the Passport — and only the gate clears it", () => {
    const state = derivePassportState({
      attestations: [attestation],
      service_gate_status: "under_review",
      case_status: "cleared",
      material_inputs_current: true,
      open_refresh_obligations: 0,
    });
    expect(state.code).toBe("refresh_required");
    expect(state.reasons).toEqual(["service_gate_regressed"]);
    expect(refreshRemedy(state.reasons)).toBe("approve_gate");
  });

  it("approving the gate — and nothing else — puts it in force", () => {
    /* No reissue. This is the promise Stage 9 now makes before the click,
       and it is the same computation the server performs after it. */
    const state = derivePassportState({
      attestations: [attestation],
      service_gate_status: "approved",
      case_status: "cleared",
      material_inputs_current: true,
      open_refresh_obligations: 0,
    });
    expect(state.code).toBe("issued_current");
    expect(state.current_version).toBe(1);
    expect(refreshRemedy(state.reasons)).toBe("none");
  });

  it("a genuine document change is still a reissue, gate or no gate", () => {
    const state = derivePassportState({
      attestations: [attestation],
      service_gate_status: "approved",
      case_status: "cleared",
      material_inputs_current: false,
      open_refresh_obligations: 0,
    });
    expect(state.code).toBe("refresh_required");
    expect(refreshRemedy(state.reasons)).toBe("reissue");
  });
});
