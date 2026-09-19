import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  partnerMatterIndex, roleWords, type MatterLinkInput,
} from "./partnerMatterIndex";

/**
 * A partner's filing cabinet.
 *
 * The reported problem: a lone blue chip labelled **"Matter …6a5a49"** — the
 * last six characters of a database row id — sitting where a control should
 * be. It names nothing a partner recognises and does not survive a partner
 * who holds ten Passports, let alone fifty.
 *
 * The rule underneath it is the one that matters: a partner is told whose
 * record a matter is ONLY where they may read that record.
 */

const link = (over: Partial<MatterLinkInput> = {}): MatterLinkInput => ({
  id: "1111-2222-3333-6a5a49",
  relationship_role: "builder_developer",
  legal_route: "reliance",
  state: "active",
  linked_at: "2026-08-20T00:00:00.000Z",
  ended_at: null,
  purchase_file_id: null,
  legal_matter_id: null,
  ...over,
});

const readable = (over: Partial<MatterLinkInput> = {}): MatterLinkInput => link({
  passport_state: "available",
  subject_label: "Rugesh Naidu",
  case_reference: "AML-2026-00005",
  ...over,
});

describe("a partner is named the customer only where they may read the record", () => {
  it("a readable matter leads with the customer, because it is on page one", () => {
    const { rows } = partnerMatterIndex([readable()]);
    expect(rows[0].title).toBe("Rugesh Naidu");
    expect(rows[0].subtitle).toContain("AML-2026-00005");
  });

  it("a WITHHELD matter never names them — that would be a new disclosure", () => {
    /* Naming the customer on a matter whose Passport is not shared would be
       a disclosure made by a list rather than by a decision. */
    for (const state of ["not_shared", "withdrawn", "expired", "updating"] as const) {
      const { rows } = partnerMatterIndex([
        // The server would not send these; belt and braces if it ever did.
        link({ passport_state: state, subject_label: "Rugesh Naidu", case_reference: "AML-2026-00005" }),
      ]);
      expect(rows[0].title, state).not.toContain("Rugesh Naidu");
      expect(rows[0].subtitle, state).not.toContain("AML-2026-00005");
    }
  });

  it("the SEARCH cannot be used to probe for a name that is not on screen", () => {
    const withheld = link({
      passport_state: "not_shared", subject_label: "Rugesh Naidu",
    });
    expect(partnerMatterIndex([withheld], { query: "rugesh" }).rows).toHaveLength(0);
    // And a name that IS on screen is findable.
    expect(partnerMatterIndex([readable()], { query: "rugesh" }).rows).toHaveLength(1);
  });

  it("an ended link is ended, whatever the passport state says", () => {
    const { rows } = partnerMatterIndex([
      readable({ state: "ended", ended_at: "2026-08-25T00:00:00.000Z" }),
    ]);
    expect(rows[0].state).toBe("ended");
    expect(rows[0].readable).toBe(false);
    expect(rows[0].title).not.toContain("Rugesh Naidu");
  });
});

describe("the label is the partner's own vocabulary first", () => {
  it("their legal matter number leads over their purchase file", () => {
    const { rows } = partnerMatterIndex([
      link({ legal_matter_id: "aaaaaaaa-1234-5678-9abc-LM0001", purchase_file_id: "bbbb-PF0002" }),
    ], { ownReferenceLabel: "Matter" });
    expect(rows[0].title).toBe("Matter …LM0001");
  });

  it("a purchase file is used when there is no legal matter", () => {
    const { rows } = partnerMatterIndex([link({ purchase_file_id: "bbbb-PF0002" })],
      { ownReferenceLabel: "File" });
    expect(rows[0].title).toBe("File …PF0002");
  });

  it("with NEITHER, it names the date — never the row id", () => {
    /* "Matter …6a5a49" was the reported defect: six characters of a UUID,
       which is not a name. */
    const { rows } = partnerMatterIndex([link()], { ownReferenceLabel: "Matter" });
    expect(rows[0].title).not.toContain("6a5a49");
    expect(rows[0].title).toMatch(/^Matter linked /);
  });

  it("a readable matter still shows the partner's own reference underneath", () => {
    const { rows } = partnerMatterIndex([readable({ purchase_file_id: "bbbb-PF0002" })],
      { ownReferenceLabel: "File" });
    expect(rows[0].title).toBe("Rugesh Naidu");
    expect(rows[0].subtitle).toContain("File …PF0002");
  });
});

describe("database vocabulary never reaches the partner", () => {
  it("a role reads as words", () => {
    expect(roleWords("builder_developer")).toBe("Builder developer");
    expect(roleWords("")).toBe("");
  });

  it("no rendered field carries an underscore-cased identifier", () => {
    const { rows } = partnerMatterIndex([readable()]);
    expect(`${rows[0].title} ${rows[0].subtitle} ${rows[0].stateLabel}`)
      .not.toMatch(/[a-z]_[a-z]/);
  });
});

describe("ordering is by usefulness, not by recency", () => {
  it("readable Passports come first, then waiting, then ended", () => {
    const { rows } = partnerMatterIndex([
      link({ id: "ended", state: "ended", ended_at: "2026-08-26T00:00:00.000Z", linked_at: "2026-08-26T00:00:00.000Z" }),
      link({ id: "waiting", passport_state: "not_shared", linked_at: "2026-08-25T00:00:00.000Z" }),
      readable({ id: "open", linked_at: "2026-08-01T00:00:00.000Z" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["open", "waiting", "ended"]);
  });

  it("within a group, most recently linked first", () => {
    const { rows } = partnerMatterIndex([
      readable({ id: "older", linked_at: "2026-08-01T00:00:00.000Z" }),
      readable({ id: "newer", linked_at: "2026-08-20T00:00:00.000Z" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("an expiring Passport is still readable, and says when", () => {
    const { rows, readable: count } = partnerMatterIndex([
      readable({ passport_state: "expiring", expires_at: "2026-09-05T00:00:00.000Z" }),
    ]);
    expect(rows[0].readable).toBe(true);
    expect(count).toBe(1);
    expect(rows[0].subtitle).toMatch(/expires /);
  });
});

describe("the header counts, and never claims anything", () => {
  it("names how many can be opened", () => {
    const { headline } = partnerMatterIndex([readable(), link()]);
    expect(headline).toBe("1 Passport available of 2 matters");
  });

  it("says so plainly when none can", () => {
    const { headline } = partnerMatterIndex([link(), link({ id: "b" })]);
    expect(headline).toMatch(/none readable yet/);
  });

  it("reports the filter while searching", () => {
    const { headline } = partnerMatterIndex([readable(), link({ id: "b" })], { query: "rugesh" });
    expect(headline).toBe("1 of 2 match");
  });

  it("is never a compliance verdict", () => {
    const { headline } = partnerMatterIndex([readable()]);
    for (const forbidden of [/\bclear\b/i, /\bcompliant\b/i, /\bverified\b/i]) {
      expect(headline).not.toMatch(forbidden);
    }
  });

  it("an empty cabinet says what will fill it", () => {
    const { headline } = partnerMatterIndex([]);
    expect(headline).toMatch(/No matters are shared/i);
  });
});

describe("wired at the source", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("the SERVER decides whether a customer may be named", () => {
    /* The browser must not be able to leak it by rendering the wrong field:
       `subject_label` simply is not sent for a withheld matter. */
    const fn = read("supabase/functions/aml-reliance/index.ts");
    expect(fn).toContain("if (decision.disclosable) {");
    expect(fn).toContain("link.subject_label = row?.subject_display_name ?? null;");
    expect(fn).toContain("passportDisclosure({");
    // And the case id itself never leaves — it is an issuer-side identifier.
    expect(fn).toContain("delete link.case_id;");
  });

  it("the directory is enriched in BATCHES, not one query per matter", () => {
    // A partner with fifty matters must not cost a hundred and fifty queries.
    const fn = read("supabase/functions/aml-reliance/index.ts");
    expect(fn).toContain("const caseIds = [...new Set(linkRows.map");
    expect(fn).toMatch(/Promise\.all\(\[\s*\n\s*admin\.schema\("aml"\)\.from\("cases"\)/);
  });

  it("the chip row is gone, replaced by the searchable list", () => {
    const workspace = read("src/components/partner-compliance/PartnerComplianceWorkspace.tsx");
    expect(workspace).toContain("PartnerMatterList");
    expect(workspace).not.toContain("adapter.formatReference(l)");
  });

  it("the page is centred and sized for the document on it", () => {
    const workspace = read("src/components/partner-compliance/PartnerComplianceWorkspace.tsx");
    /* Centred, and WIDE. The width is not decoration: `bookletGeometry`
       fits the spread to the board it is given, so every pixel of container
       is a larger, more legible document — which is the thing this page
       exists to show, and the thing that was reported as too small to read.
       The exact clamp may be re-tuned; being centred and being wider than
       the old 3xl/6xl column may not. */
    expect(workspace).toMatch(/mx-auto w-full max-w-\[(\d+)rem\]/);
    const rem = Number(workspace.match(/mx-auto w-full max-w-\[(\d+)rem\]/)![1]);
    expect(rem).toBeGreaterThanOrEqual(80);
    // Two panes on a wide screen, stacked below it.
    expect(workspace).toMatch(/lg:grid-cols-\[minmax\(\d+rem,\d+rem\)_minmax\(0,1fr\)\]/);
  });

  it("all three portals get it, because there is one workspace", () => {
    for (const page of [
      "src/pages/finance-portal/FinancePortalComplianceWorkspace.tsx",
      "src/pages/solicitor/SolicitorCompliance.tsx",
    ]) {
      expect(read(page), page).toContain("PartnerComplianceWorkspace");
    }
    // And each names a matter in its own words.
    const adapters = read("src/components/partner-compliance/adapters.ts");
    expect((adapters.match(/ownReferenceLabel:/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
