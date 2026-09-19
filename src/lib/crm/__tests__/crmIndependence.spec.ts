/**
 * CRM independence: one switch, one routing table, and a default that is
 * yesterday's behaviour.
 *
 * A CRM-independent clone answers Clients, Client Tracker, Conversations and
 * Calendar out of its own Postgres instead of GoHighLevel. The substitution is
 * carried by `CRM_PROVIDER`/`VITE_CRM_PROVIDER`, and three things have to stay
 * true or the switch becomes the defect it was built to avoid.
 *
 * **It fails to this deployment's own default, which here is `native`.** This
 * repository is the CRM-independent clone: it is provisioned with no
 * `GOHIGHLEVEL_*` secret at all, so a word this build has never heard of
 * resolving to `ghl` would point four surfaces at a vendor account that does
 * not exist — an outage dressed as a default. The vocabulary is therefore an
 * ALLOW-LIST, exactly as `payingCanUnlock` is, and for the same reason:
 * `value !== 'native'` answers yes to the empty string a missing variable
 * reads as. (In the PRIME the safe default is the opposite word. That is not a
 * contradiction: both say "degrade to what this deployment can actually do".)
 *
 * **The names live in one module.** `useGHLCalendar` invokes `'ghl-calendar'`
 * at twelve call sites. Twelve literals is twelve edits to switch a provider
 * and eleven of them would be right. `crmFunction()` is the routing table and
 * this spec fails when a CRM function name is spelled anywhere else under
 * `src/`.
 *
 * **The rule is stated once.** `resolveCrmProvider` lives in
 * `supabase/functions/_shared/crm/crmProvider.pure.ts` and the browser imports
 * it — the convention `_shared/workflow/*` already set. A second copy in `src/`
 * is how the two runtimes come to disagree about the same word.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  CRM_PROVIDER_ENV,
  crmProviderMismatch,
  ghlAffordancesAvailable,
  resolveCrmProvider,
  vendorReconciliationFunction,
  vendorReconciliationFunctionFor,
} from "../crmProvider";
import {
  DEFAULT_CRM_PROVIDER,
  isNativeCrm,
} from "../../../../supabase/functions/_shared/crm/crmProvider.pure.ts";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const SRC = join(REPO_ROOT, "src");

/** The one module allowed to name a CRM function or the env variable. */
const ROUTER = join("src", "lib", "crm", "crmProvider.ts");
const THIS_SPEC = join(
  "src",
  "lib",
  "crm",
  "__tests__",
  "crmIndependence.spec.ts",
);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every `.ts`/`.tsx` under `src/`, as repo-relative paths with `/` separators. */
function sourceFiles(): { path: string; text: string }[] {
  return walk(SRC).map((full) => ({
    path: relative(REPO_ROOT, full).split(sep).join("/"),
    text: readFileSync(full, "utf8"),
  }));
}

const ALLOWED = new Set([ROUTER, THIS_SPEC].map((p) => p.split(sep).join("/")));

/**
 * A test that NAMES a function is not a surface that CALLS one.
 *
 * The rule this guard enforces is about runtime: "a literal here reaches one
 * provider whatever this deployment is set to". A spec naming
 * `send-ghl-message` to assert something about it — `phantomColumnWrites`
 * scans edge functions by name, `crmConversations` builds a fixture around
 * one — reaches nothing at all, so it cannot reach the wrong provider.
 *
 * Stated as a RULE rather than added to `ALLOWED` as four more paths,
 * deliberately. A per-file exemption list grows every time a test is renamed
 * or added, and each entry looks like a decision somebody made about that
 * file; this is one decision about what the guard is for. The guard's reach
 * over `src/` is otherwise unchanged, and a production file is still caught.
 */
const isTest = (path: string) =>
  path.includes("/__tests__/") || /\.(test|spec)\.tsx?$/.test(path);

describe("the provider vocabulary is an allow-list that fails to ghl", () => {
  it("resolves the two words it knows", () => {
    expect(resolveCrmProvider("ghl").provider).toBe("ghl");
    expect(resolveCrmProvider("native").provider).toBe("native");
    expect(resolveCrmProvider("native").source).toBe("configured");
  });

  it("forgives case and surrounding whitespace, because an operator types it", () => {
    expect(resolveCrmProvider("  Native ").provider).toBe("native");
    expect(resolveCrmProvider("GHL").provider).toBe("ghl");
  });

  it.each([
    ["unset", undefined],
    ["null", null],
    ["empty", ""],
    ["whitespace", "   "],
  ])(
    "%s resolves to this deployment’s default, with no warning",
    (_label, raw) => {
      const r = resolveCrmProvider(raw as string | null | undefined);
      expect(r.provider).toBe(DEFAULT_CRM_PROVIDER);
      expect(r.provider).toBe("native");
      expect(r.source).toBe("default");
      // Absent is the ordinary state on this clone: the whole repository IS the
      // native deployment. It is not a misconfiguration and must not shout.
      expect(r.warning).toBeNull();
    },
  );

  it.each(["gohighlevel", "supabase", "none", "true", "off", "NATIVE_CRM"])(
    "refuses %s and says so, rather than silently choosing a side",
    (word) => {
      const r = resolveCrmProvider(word);
      expect(r.provider).toBe("native");
      expect(r.source).toBe("default");
      expect(r.warning).toContain(word);
    },
  );

  it("names the variable that was misread, per runtime", () => {
    expect(resolveCrmProvider("nope", "VITE_CRM_PROVIDER").warning).toContain(
      "VITE_CRM_PROVIDER",
    );
    expect(resolveCrmProvider("nope", "CRM_PROVIDER").warning).toContain(
      "CRM_PROVIDER",
    );
  });

  it("isNativeCrm reads the resolution and never the environment", () => {
    expect(isNativeCrm(resolveCrmProvider("native"))).toBe(true);
    expect(isNativeCrm(resolveCrmProvider("ghl"))).toBe(false);
    expect(isNativeCrm(resolveCrmProvider(undefined))).toBe(true);
  });
});

describe("a half-flipped deployment is noticed, not rendered", () => {
  it("says nothing when the server agrees, or does not say", () => {
    // The browser test build has no VITE_CRM_PROVIDER, so it believes the
    // repository default - 'native'.
    expect(crmProviderMismatch("native")).toBeNull();
    // An older function that reports no provider is not evidence of anything.
    expect(crmProviderMismatch(undefined)).toBeNull();
    expect(crmProviderMismatch("")).toBeNull();
    expect(crmProviderMismatch(null)).toBeNull();
  });

  it("names both sides and the remedy when they disagree", () => {
    const message = crmProviderMismatch("ghl");
    expect(message).toBeTruthy();
    expect(message).toContain("ghl");
    expect(message).toContain("native");
    expect(message).toContain("CRM_PROVIDER");
  });
});

describe("the CRM function names live in exactly one module", () => {
  /**
   * Both columns of the routing table. A surface that reaches a CRM function
   * by spelling its name has bypassed the switch, and it will keep working —
   * against the wrong provider — which is why this is asserted rather than
   * trusted.
   */
  const FUNCTION_NAMES = [
    "ghl-calendar",
    "crm-calendar",
    "send-ghl-message",
    "crm-send-message",
    // Vendor-reconciliation steps. They have no native counterpart, so they
    // are not in ROUTES — but they are still CRM function names and still
    // belong to the one module, which is what this list is for.
    "sync-ghl-conversations",
    "update-ghl-opportunity-stage",
  ];

  it.each(FUNCTION_NAMES)("%s is spelled only in the router", (name) => {
    const offenders = sourceFiles()
      .filter(({ path }) => !ALLOWED.has(path) && !isTest(path))
      .filter(
        ({ text }) => text.includes(`'${name}'`) || text.includes(`"${name}"`),
      )
      .map(({ path }) => path);

    expect(
      offenders,
      `${name} is named outside the router. Route it through crmFunction() in ${ROUTER} ` +
        `instead — a literal here reaches one provider whatever this deployment is set to.`,
    ).toEqual([]);
  });

  it("the env variable is named only in the router", () => {
    const offenders = sourceFiles()
      .filter(({ path }) => !ALLOWED.has(path) && !isTest(path))
      .filter(({ text }) => text.includes(CRM_PROVIDER_ENV))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("the rule itself is not re-implemented under src/", () => {
    // `resolveCrmProvider` is shared from `_shared/crm/crmProvider.pure.ts`.
    // A second definition in the browser tree is two runtimes disagreeing
    // about one word — the defect `complianceReminders` already paid for.
    const offenders = sourceFiles()
      .filter(({ path }) => path !== THIS_SPEC.split(sep).join("/"))
      .filter(({ text }) => /export\s+function\s+resolveCrmProvider/.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

describe("a vendor-reconciliation step has no native counterpart", () => {
  /**
   * `conversationSync` and `opportunityStage` were briefly rows of ROUTES,
   * naming `crm-conversations` and `crm-pipelines`. Nothing in this repository
   * defines either function, so on a CRM-independent deployment both surfaces
   * would have invoked a URL that answers 404 — a dead control, which this
   * repository has shipped once already.
   *
   * They are not capabilities with two implementations. One PULLS threads from
   * a system that, here, is not on the other end; the other PUSHES a stage
   * change after the local write has already succeeded. Under `native` the
   * honest answer to both is that the act is finished, so the router returns
   * null and a caller has nothing to invoke.
   */
  it("names no crm-* function for a step that has none", () => {
    const router = readFileSync(join(REPO_ROOT, ROUTER), "utf8");
    for (const invented of ["crm-conversations", "crm-pipelines"]) {
      expect(
        router.includes(`"${invented}"`) || router.includes(`'${invented}'`),
        `${invented} is not defined anywhere in this repository; routing to it ` +
          `is a control that answers 404.`,
      ).toBe(false);
    }
  });

  it("and no edge function by those names exists to be routed to", () => {
    // Asserted against the tree rather than trusted, because the reason the
    // router may not name them is that they are not there.
    for (const invented of ["crm-conversations", "crm-pipelines"]) {
      expect(
        existsSync(join(REPO_ROOT, "supabase", "functions", invented)),
        `${invented} exists now — either route to it or delete it, but the ` +
          `router and the tree must agree.`,
      ).toBe(false);
    }
  });

  it("withholds the vendor step's name where there is no vendor", () => {
    // The test build has no VITE_CRM_PROVIDER, so it resolves to this
    // repository's default, `native`.
    expect(vendorReconciliationFunction("conversationSync")).toBeNull();
    expect(vendorReconciliationFunction("opportunityStage")).toBeNull();
    expect(ghlAffordancesAvailable()).toBe(false);
  });

  it("and hands the right name back where there IS one", () => {
    /**
     * Asserted through `…For`, which takes the provider explicitly, because
     * `crmProvider()` resolves once per module load from a build-time
     * constant — so a test can only ever observe the branch THIS build is.
     * On this repository that is `native`, which would have left the `ghl`
     * names asserted by nothing at all: a typo in either would be invisible
     * here and would reach the prime on the next cascade, where it IS the
     * live branch.
     */
    expect(
      vendorReconciliationFunctionFor("ghl", "conversationSync"),
    ).toBe("sync-ghl-conversations");
    expect(vendorReconciliationFunctionFor("ghl", "opportunityStage")).toBe(
      "update-ghl-opportunity-stage",
    );
    expect(
      vendorReconciliationFunctionFor("native", "conversationSync"),
    ).toBeNull();
    expect(
      vendorReconciliationFunctionFor("native", "opportunityStage"),
    ).toBeNull();
  });

  it("names a function that exists in the tree", () => {
    // The other half of the same rule: `crm-conversations` may not be named
    // because it does not exist, and these two may be named because they do.
    for (const step of ["conversationSync", "opportunityStage"] as const) {
      const name = vendorReconciliationFunctionFor("ghl", step);
      expect(name).toBeTruthy();
      expect(
        existsSync(join(REPO_ROOT, "supabase", "functions", name!)),
        `${name} is routed to but not present in supabase/functions/`,
      ).toBe(true);
    }
  });

  it("EVERY call site binds the answer rather than using it inline", () => {
    /**
     * Counted, not sampled. The first version of this assertion asked whether
     * the FILE contained a binding, which a file with two call sites passes
     * while one of them writes
     * `invokeSecureFunction(vendorReconciliationFunction("…")!, …)` — the `!`
     * asserting away the very null this exists to deliver. Planted, it passed.
     *
     * So every occurrence must be preceded by `const <name> = `, and the two
     * counts must agree.
     */
    const callers = sourceFiles().filter(
      ({ path, text }) =>
        !ALLOWED.has(path) &&
        !isTest(path) &&
        text.includes("vendorReconciliationFunction("),
    );
    expect(callers.length, "nothing calls the vendor router").toBeGreaterThan(
      0,
    );
    for (const { path, text } of callers) {
      const uses = text.split("vendorReconciliationFunction(").length - 1;
      const bound = (
        text.match(/const\s+\w+\s*=\s*vendorReconciliationFunction\(/g) ?? []
      ).length;
      expect(
        bound,
        `${path}: ${uses} use(s) of vendorReconciliationFunction but ${bound} ` +
          `bound to a name. Every one must be bound so the null can be tested ` +
          `for — an inline use reaches a vendor this deployment may not have.`,
      ).toBe(uses);
    }
  });

  it("no call site asserts the null away", () => {
    const offenders = sourceFiles()
      .filter(({ path }) => !isTest(path))
      .filter(({ text }) => /vendorReconciliationFunction\([^)]*\)!/.test(text))
      .map(({ path }) => path);
    expect(
      offenders,
      "`!` here says this deployment definitely has GoHighLevel, which is the " +
        "one thing the router exists to answer.",
    ).toEqual([]);
  });
});
