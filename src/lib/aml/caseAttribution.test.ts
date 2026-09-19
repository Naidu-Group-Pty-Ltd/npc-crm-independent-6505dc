/**
 * A case that belongs to nobody, and the repair that must not be attempted.
 *
 * ── The production fact ───────────────────────────────────────────────
 * `aml.cases.client_id` was ON DELETE SET NULL. Deleting a client neither
 * failed nor cascaded — it DETACHED the case. Measured before the fix: 1 of 6
 * cases. AML-2026-00001 (`edd_required`, still open) had been opened for
 * client 658e8e83-…, a real customer with a house-and-land deal and three
 * notes, and that client had since been deleted.
 *
 * The FK is RESTRICT now, so nothing new can be detached this way. That fixes
 * the future and does nothing for the rows already in that state — and a
 * detached case renders exactly like an ordinary one, which is the whole
 * problem: an analyst works it, requests documents, and there is no customer
 * at the other end.
 *
 * ── The repair this module refuses ────────────────────────────────────
 * Three clients in that production database are called some casing of
 * "Rugesh Naidu". The deleted one is none of them. Re-pointing a detached
 * case at whichever live customer shares the name would make the register
 * look correct and send every subsequent request to the wrong person — a
 * worse outcome than the orphan, and the reason the recovered id is reported
 * as EVIDENCE rather than written back to `client_id`.
 */
import { describe, expect, it } from "vitest";

import {
  readCaseAttribution,
  type CaseAttributionFacts,
} from "../../../supabase/functions/_shared/aml/caseAttribution.pure";

const facts = (over: Partial<CaseAttributionFacts> = {}): CaseAttributionFacts => ({
  clientId: null,
  orphanedClient: {
    client_id: "658e8e83-5fee-4697-b474-c95cd4d99f44",
    client_still_exists: false,
    recovered_from: "case_events.payload.client_id",
  },
  ...over,
});

describe("an attributed case is left alone", () => {
  it("reports attribution and blocks nothing", () => {
    const a = readCaseAttribution(facts({ clientId: "6a69bb9f-2ea6-4948-b0a8-5e4fa0fe9201" }));
    expect(a.state).toBe("attributed");
    expect(a.blocking).toBe(false);
    expect(a.recoveredClientId).toBeNull();
  });

  it("prefers the live link over any recovery stamp", () => {
    // A case that was repaired and re-linked must not keep announcing itself
    // as detached because the historical stamp is still on the row.
    const a = readCaseAttribution(facts({ clientId: "6a69bb9f-2ea6-4948-b0a8-5e4fa0fe9201" }));
    expect(a.state).toBe("attributed");
  });
});

describe("a detached case announces itself", () => {
  it("blocks, so it is not worked as ordinary", () => {
    const a = readCaseAttribution(facts());
    expect(a.state).toBe("detached");
    expect(a.blocking).toBe(true);
  });

  it("names the client the audit chain recorded", () => {
    // The chain is the only place the link survived, and naming it is what
    // makes the record attributable again.
    expect(readCaseAttribution(facts()).recoveredClientId)
      .toBe("658e8e83-5fee-4697-b474-c95cd4d99f44");
  });

  it("says the record is retained, not lost", () => {
    expect(readCaseAttribution(facts()).detail).toMatch(/retained/i);
  });

  it("forbids re-pointing it at a customer who shares a name", () => {
    // The single most dangerous mis-repair available here.
    const d = readCaseAttribution(facts()).detail;
    expect(d).toMatch(/share a name|shares a name/i);
    expect(d).toMatch(/wrong person/i);
  });

  it("leaves the decision with the MLRO", () => {
    expect(readCaseAttribution(facts()).detail).toMatch(/MLRO/);
  });
});

describe("when the client id resolves again", () => {
  it("offers a re-link and calls it a repair rather than a guess", () => {
    const a = readCaseAttribution(facts({
      orphanedClient: {
        client_id: "658e8e83-5fee-4697-b474-c95cd4d99f44", client_still_exists: true,
      },
    }));
    expect(a.state).toBe("detached");
    expect(a.blocking).toBe(true);
    expect(a.detail).toMatch(/repair rather than a guess/i);
  });

  it("still does not re-link on its own", () => {
    // Nothing here writes. A page render is not the place a compliance
    // attribution is decided.
    const a = readCaseAttribution(facts({
      orphanedClient: { client_id: "x", client_still_exists: true },
    }));
    expect(a.blocking).toBe(true);
  });
});

describe("when the chain remembers nothing", () => {
  const unrecoverable: Array<CaseAttributionFacts["orphanedClient"]> = [
    null, undefined, {}, { client_id: null }, { client_id: "" },
  ];

  it("is the worst state and is never silent", () => {
    for (const orphanedClient of unrecoverable) {
      const a = readCaseAttribution(facts({ orphanedClient }));
      expect(a.state, JSON.stringify(orphanedClient)).toBe("detached_unrecoverable");
      expect(a.blocking).toBe(true);
      expect(a.recoveredClientId).toBeNull();
    }
  });

  it("says the record must still be retained", () => {
    const a = readCaseAttribution(facts({ orphanedClient: null }));
    expect(a.detail).toMatch(/must be retained/i);
    expect(a.detail).toMatch(/MLRO/);
  });

  it("does not pretend the case can be progressed", () => {
    expect(readCaseAttribution(facts({ orphanedClient: null })).detail)
      .toMatch(/cannot be worked|cannot be progressed/i);
  });
});

describe("it reports attribution and never identity", () => {
  it("produces no customer-facing claim in any branch", () => {
    for (const over of [
      {}, { clientId: "live-id" }, { orphanedClient: null },
      { orphanedClient: { client_id: "x", client_still_exists: true } },
    ] as Array<Partial<CaseAttributionFacts>>) {
      const a = readCaseAttribution(facts(over));
      expect(Object.keys(a).sort())
        .toEqual(["blocking", "detail", "label", "recoveredClientId", "state"]);
      expect(a.label).toBeTruthy();
      expect(a.detail.length).toBeGreaterThan(20);
      // Only an attributed case is non-blocking.
      expect(a.blocking).toBe(a.state !== "attributed");
    }
  });

  it("never invents a client id", () => {
    // The only id it may report is the one it was handed.
    expect(readCaseAttribution(facts({ orphanedClient: null })).recoveredClientId).toBeNull();
    expect(readCaseAttribution(facts({ clientId: "live" })).recoveredClientId).toBeNull();
  });
});
