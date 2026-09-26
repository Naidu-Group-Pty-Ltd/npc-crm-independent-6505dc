/**
 * The migration object index is generated and must stay current, because a
 * consumer reads an absent name as "never ours" — the reading that would let
 * one of this repository's own leftovers pass as a tenant's data.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildIndex,
  indexIsCarriedNotAuthored,
} from "../../../scripts/build-migration-object-index.mjs";

const committed = JSON.parse(readFileSync("supabase/migration-object-index.json", "utf8"));

describe("the committed index matches the migrations it describes", () => {
  // Skipped where Mission Control owns the backend, by the same
  // `indexIsCarriedNotAuthored` the CI check reads — one implementation, so a
  // clone cannot be failed by one of them and excused by the other. Every
  // other assertion below is about the FILE and stays true wherever it is
  // carried; this one alone is about THIS repository's migrations.
  /*
   * Timed, not guessed. `buildIndex()` reads all 1,014 migrations, and
   * `supabase/migrations` is 620 MB — 587 MB of it the generated template
   * library, nineteen seed releases at ~41.7 MB each. Measured on an idle
   * machine it takes 3.9 s, which is inside vitest's 5 s default and outside
   * it the moment anything else is running: this test failed at 8.5 s in a
   * parallel run while `npm run migrations:index:check` reported the index
   * current in the same working tree.
   *
   * The allowance is raised rather than the generator narrowed. Teaching
   * `buildIndex` to skip files is a change to what the index DESCRIBES, and
   * the index exists so that an absent object name reads as "never ours" —
   * the reading that would let one of this repository's leftovers pass as a
   * tenant's data. That is not a property to trade for four seconds.
   */
  it.skipIf(indexIsCarriedNotAuthored())(
    "regenerating produces exactly what is committed",
    { timeout: 120_000 },
    () => {
      // The same assertion `npm run migrations:index:check` makes in CI, kept
      // here too so a local run catches it before the push.
      expect(buildIndex()).toEqual(committed);
    },
  );

  it("carries a schema version, so a consumer can tell an old index apart", () => {
    expect(committed.schema_version).toBe(1);
  });
});

describe("it records what this repository created and what it dropped", () => {
  it("finds the object that started this, by the drop that disowns it", () => {
    /*
     * `public.builder_design_images` is present on a tenant provisioned from
     * this repository and in no schema here. It used to be BOTH created and
     * dropped in the tree — 20261102000000_builder_design_images.sql against
     * 20261104000000_builder_stock_withdraw_design_renders.sql — and that
     * pair was what named it ours.
     *
     * "Phase 7 wave 3 — the builder portal leaves the prime, one way"
     * (d545665) took the creating migration out of the tree, so only the drop
     * remains. That is still the reading the index exists to give: a consumer
     * seeing this name on a tenant can tell it is this repository's leftover
     * rather than the tenant's own table. The `created` half is asserted
     * where it is still true — the corpus test below — because pinning a name
     * whose migration has left is how this test came to describe a file that
     * no longer exists.
     */
    expect(committed.dropped).toContain("table:public.builder_design_images");
    expect(committed.created).not.toContain("table:public.builder_design_images");
  });

  it("is a real corpus rather than a stub", () => {
    expect(committed.migration_files).toBeGreaterThan(900);
    expect(committed.created.length).toBeGreaterThan(2000);
  });

  it("every entry is a lowercased class:name pair with no quotes", () => {
    for (const entry of [...committed.created, ...committed.dropped]) {
      expect(entry).toMatch(/^[a-z_]+:[^"\s]+$/);
      expect(entry).toBe(entry.toLowerCase());
    }
  });

  it("names nothing this repository never had", () => {
    // A tenant's own object must not appear, or the classifier downstream
    // would call it ours and offer it for removal.
    expect(committed.created).not.toContain("table:public.a_tenant_invented_this");
  });
});
