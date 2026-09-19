/**
 * The last mile between a loaded sanctions list and a screening that runs.
 *
 * ── The dead end ──────────────────────────────────────────────────────
 * Loading the DFAT Consolidated List was necessary to screen anybody and it
 * was never sufficient. `aml.provider_configs` carries a `mode` for
 * `pep_sanctions/local_lists`, and production refuses to run a provider in
 * `simulator` mode — correctly, because the screening simulator returns
 * **"clear" for everyone** who does not match a hardcoded keyword list.
 *
 * So an MLRO could load the legally operative register in full and Stage 5
 * would still refuse, with nothing on the page to press. The only way to
 * finish the job was an undocumented UPDATE against `provider_configs`, and
 * no surface in the product performed it.
 *
 * ── Why the ingest owns this ──────────────────────────────────────────
 * `local_lists` calls no vendor. It queries `aml.sanctions_entries` behind its
 * own freshness gate, so whether it can answer is decided by the data. A
 * separate `mode` flag is a second source of truth about that same fact, and
 * it can only ever disagree in one of two ways — claiming a readiness it does
 * not have, or refusing when it could answer. Promoting on a real load makes
 * the flag a consequence of the data instead of a parallel assertion.
 *
 * ── The line this must never cross ────────────────────────────────────
 * "Do not simply flip mode = live to make the error disappear." That is the
 * standing instruction, and it is why the second describe block below is
 * longer than the first: every refusal is asserted, and each one is a way the
 * platform could otherwise come to claim it screens people when it does not.
 */
import { describe, expect, it } from "vitest";

import {
  PROMOTING_LIST,
  decideProviderPromotion,
} from "../../../supabase/functions/_shared/aml/sanctionsIngest.pure";

const load = (over: Partial<Parameters<typeof decideProviderPromotion>[0]> = {}) =>
  decideProviderPromotion({
    listCode: "dfat", entriesWritten: 7_412, currentMode: "simulator", active: true, ...over,
  });

/* ═════════ The one case that promotes ═════════ */

describe("a real load of the legally operative list makes screening live", () => {
  it("promotes out of simulator", () => {
    const d = load();
    expect(d.promote).toBe(true);
    expect(d.reason).toMatch(/screening is now live/i);
  });

  it("says why the list alone was not enough", () => {
    // The operator has just done the work and needs to know what it bought
    // them. "Loaded 7,412 entries" was true before and screened nobody.
    expect(load().reason).toMatch(/production refuses to run|simulator mode/i);
  });

  it("promotes on any non-zero write, however small", () => {
    // A short list is a compliance question, not a promotion question — the
    // provider's freshness gate and the ingest's shrink floor own that.
    expect(load({ entriesWritten: 1 }).promote).toBe(true);
  });

  it("is keyed to DFAT, the source the provider actually requires", () => {
    expect(PROMOTING_LIST).toBe("dfat");
  });

  it("accepts the list code however it was cased", () => {
    for (const listCode of ["DFAT", "Dfat", "dfat"]) {
      expect(load({ listCode }).promote, listCode).toBe(true);
    }
  });
});

/* ═════════ Every way it must refuse ═════════ */

describe("it never flips the mode to make an error disappear", () => {
  it("refuses on a list that is not the operative one", () => {
    // UN and OFAC corroborate. Neither is the Australian TFS source, and
    // loading one must not license screening that DFAT has not backed.
    for (const listCode of ["un", "ofac", "eu", ""]) {
      const d = load({ listCode });
      expect(d.promote, listCode).toBe(false);
      expect(d.reason).toMatch(/DFAT Consolidated List/i);
    }
  });

  it("refuses when nothing was written", () => {
    // The decisive case. A zero-entry load that promoted would publish a
    // provider claiming to screen against an empty register — which returns
    // clear for everybody and looks exactly like screening that worked.
    for (const entriesWritten of [0, -1, Number.NaN]) {
      const d = load({ entriesWritten });
      expect(d.promote, String(entriesWritten)).toBe(false);
      expect(d.reason).toMatch(/no entries were written/i);
    }
  });

  it("never reactivates a deactivated provider", () => {
    // Deactivation is a deliberate act by a person — often the response to a
    // provider that is misbehaving. Loading data must not reverse it.
    for (const active of [false, null, undefined]) {
      const d = load({ active });
      expect(d.promote, String(active)).toBe(false);
      expect(d.reason).toMatch(/deactivated/i);
      expect(d.reason).toMatch(/deliberate decision/i);
    }
  });

  it("does not re-promote a provider that is already live", () => {
    // A weekly refresh is not a change of posture, and recording it as one
    // would bury the entry that matters in a log of identical ones.
    const d = load({ currentMode: "live" });
    expect(d.promote).toBe(false);
    expect(d.reason).toMatch(/already live/i);
    expect(d.reason).toMatch(/refreshed/i);
  });

  it("checks the list before the count, so the message names the real reason", () => {
    // An operator loading UN with an empty file should be told this is not
    // the promoting list, not sent looking for missing rows.
    expect(load({ listCode: "un", entriesWritten: 0 }).reason).toMatch(/DFAT/i);
  });

  it("checks activation before the current mode", () => {
    // A deactivated, already-live provider is a deactivated provider.
    expect(load({ active: false, currentMode: "live" }).reason).toMatch(/deactivated/i);
  });

  it("has no input that produces a demotion", () => {
    // Nothing here may take a live provider down. Staleness is the provider's
    // own gate and fails closed as a technical condition; turning it into a
    // mode change would let a stale list read as a settled posture.
    for (const listCode of ["dfat", "un", "ofac"]) {
      for (const entriesWritten of [0, 1, 9_999]) {
        for (const active of [true, false]) {
          const d = decideProviderPromotion({
            listCode, entriesWritten, currentMode: "live", active,
          });
          expect(d.promote, `${listCode}/${entriesWritten}/${active}`).toBe(false);
          expect(d.reason).not.toMatch(/simulator mode now|demot|disabl/i);
        }
      }
    }
  });

  it("always explains itself", () => {
    // Every outcome reaches an operator as a sentence in a toast. A silent
    // refusal is the dead end this whole change exists to close.
    for (const over of [
      {}, { listCode: "un" }, { entriesWritten: 0 }, { active: false },
      { currentMode: "live" }, { currentMode: null }, { active: undefined },
    ] as Array<Partial<Parameters<typeof decideProviderPromotion>[0]>>) {
      const d = load(over);
      expect(d.reason.length, JSON.stringify(over)).toBeGreaterThan(20);
      // It must never read as a screening outcome.
      expect(d.reason).not.toMatch(/\bclear\b|no match|screened clean/i);
    }
  });
});

/* ═════════ It decides permission to run, never an outcome ═════════ */

describe("promotion is not a result", () => {
  it("produces no screening verdict in any branch", () => {
    for (const over of [
      {}, { listCode: "un" }, { entriesWritten: 0 }, { active: false }, { currentMode: "live" },
    ] as Array<Partial<Parameters<typeof decideProviderPromotion>[0]>>) {
      const d = load(over);
      expect(Object.keys(d).sort()).toEqual(["promote", "reason"]);
      expect(typeof d.promote).toBe("boolean");
    }
  });

  it("is pure — the same facts give the same answer", () => {
    expect(load()).toEqual(load());
    expect(load({ active: false })).toEqual(load({ active: false }));
  });
});

/* ═════════ How current the DATA is, not how recent the upload ═════════ */

/**
 * The near-miss that produced this.
 *
 * Trying to load the list for real, DFAT's own canonical URL —
 * `/sites/default/files/regulation8_consolidated.xlsx` — answered 404 with
 * `location: …/regulation8_consolidated_2.xls` (its own Drupal redirect,
 * `x-redirect-id: 51826`). That file downloaded cleanly: 2.4 MB, valid
 * Excel, `[SEC=OFFICIAL]`, 7,840 rows, every column exactly where
 * `rowsToDfatEntries` expects it.
 *
 * Its newest Control Date is **2022-01-07**. Nothing from 2023, 2024, 2025
 * or 2026 — it predates the entire Russia/Ukraine listing expansion.
 *
 * Every freshness control in this platform measures WHEN WE SYNCED, so that
 * file loaded today would have produced a `succeeded` sync stamped now, made
 * `dfatLoaded` true, promoted the provider to live, turned every gate green,
 * and screened every client against a four-year-old register — returning
 * **clear** for everyone listed since.
 *
 * These tests are taken from the real file's actual shape.
 */
import { LIST_STALE_AFTER_DAYS, assessListRecency } from "../../../supabase/functions/_shared/aml/sanctionsIngest.pure";

const NOW = Date.parse("2026-08-16T00:00:00Z");
const sheet = (controlDates: string[]) => [
  ["Reference", "Name of Individual or Entity", "Type", "Name Type", "Control Date"],
  ...controlDates.map((d, i) => [`${i + 1}`, `SUBJECT ${i}`, "Individual", "Primary Name", d]),
];

describe("a file's own dates decide whether it is the current list", () => {
  it("catches the 2022 file DFAT currently redirects to", () => {
    const r = assessListRecency(sheet(["15/12/2014", "7/01/2022", "3/11/2021"]), NOW);
    expect(r.stale).toBe(true);
    expect(r.newestListing).toBe("2022-01-07");
    expect(r.reason).toMatch(/not the current Consolidated List/i);
    expect(r.reason).toMatch(/report them clear/i);
  });

  it("accepts a genuinely current list", () => {
    const r = assessListRecency(sheet(["23/07/2026", "15/12/2014"]), NOW);
    expect(r.stale).toBe(false);
    expect(r.newestListing).toBe("2026-07-23");
  });

  it("takes the NEWEST date, not the first or last row", () => {
    // A current list is mostly old listings — the file is cumulative.
    const r = assessListRecency(sheet(["15/12/2014", "23/07/2026", "3/11/2003"]), NOW);
    expect(r.newestListing).toBe("2026-07-23");
    expect(r.stale).toBe(false);
  });

  it("reads the month-first two-digit dates the published file actually carries", () => {
    /*
     * The list published 21 July 2026, read the way the upload page reads it
     * (`sheet_to_json` with `raw: false`), yields `3/26/26` and `5/8/26`:
     * MONTH-first, TWO-digit year. The previous implementation accepted only
     * `d/m/yyyy` and ISO, so against the current published list it matched
     * nothing and reported "no readable listing dates" — the guard was inert
     * on the very file it exists to judge.
     */
    const r = assessListRecency(sheet(["3/26/26", "5/8/26", "8/16/12"]), NOW);
    expect(r.unknown).toBe(false);
    expect(r.newestListing).toBe("2026-05-08");
    expect(r.stale).toBe(false);
  });

  it("decides day-first vs month-first from the column, not the cell", () => {
    // `5/8/26` alone is ambiguous. `23/07/2026` in the same column is not,
    // and it settles the whole file as day-first — so `5/8/26` is 5 August.
    const dayFirst = assessListRecency(sheet(["23/07/2026", "5/8/26"]), NOW);
    expect(dayFirst.newestListing).toBe("2026-08-05");

    // The mirror image: `3/26/26` proves month-first, so the SAME cell is
    // 8 May. One value elsewhere in the column changes what this one means.
    const monthFirst = assessListRecency(sheet(["3/26/26", "5/8/26"]), NOW);
    expect(monthFirst.newestListing).toBe("2026-05-08");
  });

  it("takes the OLDER reading when the whole column is ambiguous", () => {
    /*
     * Every value at 12 or below in both positions, which across thousands of
     * listings does not happen by accident. A staleness guard may only err
     * towards refusing: reading a file as older than it is costs a deliberate
     * force, reading it as newer admits the out-of-date register.
     */
    const r = assessListRecency(sheet(["3/11/2003", "5/8/2004"]), NOW);
    // month-first reads 2004-05-08; day-first reads 2004-08-05. Older wins.
    expect(r.newestListing).toBe("2004-05-08");
    expect(r.stale).toBe(true);
  });

  it("still refuses a date that rolls over rather than validating", () => {
    // Date.UTC does not validate — 31/31/9999 becomes year 10001, and one
    // malformed cell would make an archived file the newest list ever.
    const r = assessListRecency(sheet(["31/31/9999", "15/12/2014"]), NOW);
    expect(r.newestListing).toBe("2014-12-15");
    // 31 April does not exist either, and the range check alone allows it.
    const april = assessListRecency(sheet(["31/04/2026", "15/12/2014"]), NOW);
    expect(april.newestListing).toBe("2014-12-15");
  });

  it("is generous enough never to fire on a live list", () => {
    // DFAT amends many times a year; a full year of silence is the wrong file.
    expect(LIST_STALE_AFTER_DAYS).toBe(365);
    const justInside = assessListRecency(sheet(["20/08/2025"]), NOW);
    expect(justInside.stale).toBe(false);
  });

  it("reports unknown rather than fresh when no date can be read", () => {
    // Not reading a date is not evidence of currency.
    for (const rows of [
      sheet([]),
      [["Reference", "Name of Individual or Entity"], ["1", "SUBJECT"]],
      sheet(["", "not a date"]),
    ]) {
      const r = assessListRecency(rows, NOW);
      expect(r.unknown).toBe(true);
      expect(r.stale).toBe(false);
      expect(r.newestListing).toBeNull();
    }
  });

  it("reads ISO dates too, so a re-exported file still works", () => {
    expect(assessListRecency(sheet(["2026-07-23"]), NOW).newestListing).toBe("2026-07-23");
  });

  it("ignores a malformed date rather than treating it as now", () => {
    const r = assessListRecency(sheet(["31/31/9999", "7/01/2022"]), NOW);
    expect(r.newestListing).toBe("2022-01-07");
    expect(r.stale).toBe(true);
  });

  it("never reports a screening outcome", () => {
    for (const rows of [sheet(["7/01/2022"]), sheet(["23/07/2026"]), sheet([])]) {
      const r = assessListRecency(rows, NOW);
      expect(Object.keys(r).sort())
        .toEqual(["ageDays", "newestListing", "reason", "stale", "unknown"]);
    }
  });
});
