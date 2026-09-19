import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideProvider,
  technicalCategoryForRefusal,
} from "../../../supabase/functions/_shared/aml/providerEnvironment.ts";

/**
 * A typed refusal must reach the operator as the right remedy.
 *
 * ## The defect this pins
 *
 * There are three refusal codes and two consumers collapsed them with the
 * same hand-written ternary:
 *
 *     err.code === 'provider_misconfigured' ? 'provider_misconfigured'
 *                                           : 'provider_not_configured'
 *
 * which sent `simulator_blocked_in_production` to the "nothing is
 * configured" branch. Production's screening provider row is `local_lists`,
 * active, in `simulator` mode — configured, and unable to execute. So the
 * message the administrator would have been shown was "No screening provider
 * is configured for this tenant. An administrator must configure one": a
 * remedy that asks for a provider which already exists, while the real
 * remedy — finish configuring that one as live and load a list for it — is
 * never named.
 *
 * The distinction is the whole point of the two categories. **Not
 * configured** means there is nothing there to fix. **Misconfigured** means
 * something is there and is unfinished. Only the absence of a provider row
 * is the former.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

describe("refusal codes map to the category that names the right remedy", () => {
  it("only an absent provider is 'not configured'", () => {
    expect(technicalCategoryForRefusal("provider_not_configured"))
      .toBe("provider_not_configured");
  });

  it("a provider left in simulator mode is misconfigured, not absent", () => {
    expect(technicalCategoryForRefusal("simulator_blocked_in_production"))
      .toBe("provider_misconfigured");
  });

  it("an unwired or incomplete live provider stays misconfigured", () => {
    expect(technicalCategoryForRefusal("provider_misconfigured"))
      .toBe("provider_misconfigured");
  });

  it("maps production's actual configuration to 'misconfigured'", () => {
    // The row measured in production on 2026-08-18: capability pep_sanctions,
    // provider_key local_lists, mode simulator, active. This is the case the
    // ternary got wrong, so it is asserted end-to-end rather than by code.
    const decision = decideProvider({
      environment: "production",
      mode: "simulator",
      providerKey: "local_lists",
      adapterWired: true,
      adapterConfigured: true,
    });
    expect(decision.kind).toBe("refuse");
    if (decision.kind !== "refuse") return;
    expect(decision.code).toBe("simulator_blocked_in_production");
    expect(technicalCategoryForRefusal(decision.code)).toBe("provider_misconfigured");
  });

  it("still calls a genuinely empty configuration 'not configured'", () => {
    const decision = decideProvider({
      environment: "production",
      mode: "simulator",
      providerKey: "simulator",
      adapterWired: false,
      adapterConfigured: false,
    });
    expect(decision.kind).toBe("refuse");
    if (decision.kind !== "refuse") return;
    expect(technicalCategoryForRefusal(decision.code)).toBe("provider_not_configured");
  });
});

describe("no caller re-collapses the refusal codes by hand", () => {
  const callers = [
    "supabase/functions/_shared/aml/screeningConsumer.ts",
    "supabase/functions/cross-portal-outbox-worker/verificationConsumer.ts",
    "supabase/functions/_shared/aml/standaloneVerification.ts",
  ];

  it.each(callers)("%s uses the shared mapping", (path) => {
    const src = read(path);
    expect(src).toMatch(/technicalCategoryForRefusal\(/);
    // The exact shape that dropped `simulator_blocked_in_production`: a
    // comparison against one code, with the other as the fallback.
    expect(src).not.toMatch(
      /err\.code\s*===\s*['"]provider_misconfigured['"]\s*\r?\n?\s*\?/,
    );
  });
});
