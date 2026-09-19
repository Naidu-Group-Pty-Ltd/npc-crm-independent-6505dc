/**
 * Phase 2 — production-surface disclosure rules (directive §6.1 / §20.1).
 * Ordinary AML pages must not render role lists, feature-flag names, internal
 * permission terminology or arrow-encoded internal workflow. These source
 * tests fail if that metadata creeps back into the UI copy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repo = process.cwd();
const casesSource = readFileSync(join(repo, "src/pages/aml/AmlCases.tsx"), "utf8");
const guardSource = readFileSync(join(repo, "src/components/aml/AmlGuard.tsx"), "utf8");
const homeV3Source = readFileSync(join(repo, "src/pages/aml/AmlComplianceHomeV3.tsx"), "utf8");
const overviewSource = readFileSync(join(repo, "src/pages/aml/AmlOverview.tsx"), "utf8");

describe("no developer or role metadata on production AML surfaces", () => {
  it("case register header does not print the caller's role list", () => {
    expect(casesSource).not.toMatch(/roles:\s*[""{]/);
    expect(casesSource).not.toContain("access.roles].join");
  });

  it("empty states do not name feature flags", () => {
    for (const source of [casesSource, guardSource, homeV3Source, overviewSource]) {
      expect(source).not.toContain("behind the aml_ctf feature flag");
      expect(source).not.toMatch(/<code>\s*aml_ctf/);
    }
  });

  it("empty states do not enumerate internal role taxonomy", () => {
    for (const source of [casesSource, guardSource, homeV3Source, overviewSource]) {
      expect(source).not.toMatch(/analyst,? reviewer,? (MLRO|mlro)/i);
      expect(source).not.toContain("Ask a superadmin");
    }
  });

  it("status labels avoid arrow-encoded internal workflow", () => {
    for (const source of [casesSource, homeV3Source, overviewSource]) {
      expect(source).not.toContain("Escalated → MLRO");
    }
  });

  it("capability names are not rendered to end users", () => {
    expect(guardSource).not.toMatch(/<code>\{?capability/);
  });

  it("V3 home leads with an operational queue, not generic continuation", () => {
    expect(homeV3Source).not.toContain("Continue where you work most");
    expect(homeV3Source).toContain("Priority work queue");
  });
});
