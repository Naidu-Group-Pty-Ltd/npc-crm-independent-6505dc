/**
 * Client-facing deployment mode.
 *
 * One build of this dashboard serves two audiences: the internal operations
 * console (everything on), and client-facing deployments where the
 * developer/operator tooling — integration credential management, the workflow
 * playground, engine diagnostics, test-data controls — must not appear at all.
 *
 * The mode is decided per BUILD by `VITE_CLIENT_FACING` and nothing else, and
 * it reaches the running code as the `__CLIENT_FACING__` constant that
 * `vite.config.ts` folds in — never by reading the environment at runtime.
 * `isClientFacingDeployment()` records what that cost.
 * Unlike `editorV2Flag` / `templateLibrary` there is deliberately no URL-param
 * or localStorage override: those exist so an operator can flip a feature for
 * one visit, and the whole point of a client-facing deployment is that a
 * visitor cannot flip the operator tooling back on from the address bar.
 * Default OFF — a build that never heard of the flag behaves exactly as today.
 *
 * This flag controls VISIBILITY, never data access. Module permissions,
 * workspace entitlements and the edge functions' own auth checks enforce
 * access independently of it; hiding a surface here changes no server
 * behaviour. In particular, hiding the Integrations page does not touch the
 * Make.com → Airtable "Property Intake Master" pipeline — that runs entirely
 * server-side and never depended on this UI being visible.
 *
 * Both the navigation filter (src/hooks/useNavigation.ts) and the route gate
 * (src/components/auth/ClientFacingGate.tsx) read the ONE list below, so what
 * is unlinked and what is unroutable cannot drift apart.
 */

/*
 * The Vite `define` constants, declared HERE as well as in `global.d.ts` and
 * `src/client-facing.d.ts`. The platform's own typecheck runs over a file list
 * that picks up neither ambient file, and an undeclared name reported as four
 * errors on every build. A module-scope `declare const` shadows the ambient one
 * harmlessly and cannot be missed by any configuration that compiles this file.
 */
declare const __CLIENT_FACING__: boolean;
declare const __CLIENT_FACING_ALLOW__: readonly string[];


/**
 * The truth table for the raw value: only an explicit opt-in enables the mode.
 *
 * Exported because `vite.config.ts` computes `__CLIENT_FACING__` with it, so
 * "what counts as on" is spelled once rather than repeated in the config.
 */
export function resolveClientFacingFlag(envValue: string | boolean | undefined): boolean {
  return envValue === true || envValue === '1' || envValue === 'true';
}

/**
 * The mode, read from the ONE authority: the build constant.
 *
 * This used to read
 * `(import.meta as { env?: … })?.env?.VITE_CLIENT_FACING`, and that is a
 * defect with no symptom of its own until it has a very large one. The cast
 * sends the expression through esbuild's TypeScript transform, which lowers
 * the optional chain into temporaries — `(_a = import.meta) == null ? void 0 :
 * _a.env` — so the token `import.meta.env` no longer exists by the time Vite
 * substitutes it. `import.meta` therefore survives into the browser, where it
 * carries `url` and `resolve` and no `env` at all, and the whole expression is
 * `undefined`. Every client-facing build reported itself as the internal
 * console: the navigation filter never engaged, `ClientFacingGate` waved every
 * hidden URL through, and each component-level gate in
 * `docs/CLIENT_FACING_MODE.md` drew its operator control. Written plainly as
 * `import.meta.env.VITE_CLIENT_FACING` it would have folded — the bug was the
 * cast, not the idea.
 *
 * Meanwhile `__CLIENT_FACING__` is a `define`, which IS folded, and it had
 * correctly dropped five page chunks from the same bundle. So the two halves
 * of one decision disagreed inside one build, and the page behind a dropped
 * chunk rendered nothing at all.
 *
 * Nothing in this module may name `import.meta` again; a test asserts that
 * over this file's own source, because the failure is invisible in every
 * environment that has an `import.meta.env` — which includes the dev server
 * and the test runner.
 */
export function isClientFacingDeployment(): boolean {
  return typeof __CLIENT_FACING__ === 'boolean' ? __CLIENT_FACING__ : false;
}

/**
 * Path prefixes of developer/operator tooling. A path is hidden when it equals
 * an entry or sits underneath one (so `/integrations` also covers
 * `/integrations/ghl-migration`). Entries must start with `/` and carry no
 * trailing slash — a test enforces both.
 *
 * Deliberately NOT here (business features a client workspace runs itself):
 * templates and the template builder, branding/white-label, settings, user
 * management, the portal admin pages, data import and automation.
 */
export const CLIENT_FACING_HIDDEN_PATHS: readonly string[] = [
  // Integration credential management (Supabase secrets, API keys) and the
  // automation canvas. Hiding these is UI-only: the intake pipeline they
  // describe keeps running untouched.
  '/integrations',
  '/workflow-playground',

  // Infrastructure & engine operations.
  '/cloudflare',
  '/model-hub',
  '/api-usage',
  '/monitoring',
  '/error-logs',
  '/quality-assurance',

  // Intake pipeline diagnostics (which mailboxes feed listings).
  '/sources',

  // Superadmin/engineering diagnostics under /admin.
  '/admin/token-audit',
  '/admin/report-engine-inspector',
  '/admin/pdf-import-engine',
  '/admin/pdf-import-diagnostics',
  '/admin/pdf-import-monitoring',
  '/admin/pdf-import-retention',
  '/admin/pdf-import-client-reports',
  '/admin/template-import-quality',
  '/admin/pdf-golden-regression',
  '/admin/market-qa-quality',
  '/admin/agent-quality',
  '/admin/bc-segment-engine',
  '/admin/reclassify-property',
  '/admin/aml-v3-cutover',
  '/admin/aml-integration-health',
];

/**
 * Paths this deployment keeps even though the list above hides them, named at
 * BUILD time by `VITE_CLIENT_FACING_ALLOW` (comma-separated).
 *
 * An allowance has to reach both halves of the mode or it is a trap. The list
 * above decides what is linked and routable; `__EXCLUDE_*__` in App.tsx
 * decides whether a page's chunk is emitted at all. Allowing a path in one and
 * not the other reproduces exactly the divergence this module was repaired
 * for — a reachable route with nothing behind it — so `vite.config.ts` derives
 * both from this one parsed list.
 *
 * Only an entry appearing verbatim in `CLIENT_FACING_HIDDEN_PATHS` is
 * honoured: an allowance may only give back something the list took, and a
 * typo must not be able to name a path nobody reviewed.
 */
export function parseDeploymentAllowances(
  raw: string | undefined,
  hidden: readonly string[] = CLIENT_FACING_HIDDEN_PATHS,
): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index)
    .filter((entry) => hidden.includes(entry));
}

/**
 * The allowances this build was compiled with. Resolved once: the define is
 * inlined as an array literal, so reading it per call would allocate per call.
 */
const BUILD_ALLOWANCES: readonly string[] =
  typeof __CLIENT_FACING_ALLOW__ === 'undefined' ? [] : __CLIENT_FACING_ALLOW__;

export function deploymentAllowances(): readonly string[] {
  return BUILD_ALLOWANCES;
}

/**
 * The hidden-list entry a path falls under, or null.
 *
 * The LONGEST match wins, so a more specific entry keeps its own decision
 * whatever order the list happens to be written in: allowing
 * `/admin/finance-portal` still leaves `/admin/finance-portal/health` hidden,
 * because that page has an entry of its own.
 */
export function matchedHiddenPath(
  pathname: string,
  hidden: readonly string[] = CLIENT_FACING_HIDDEN_PATHS,
): string | null {
  const normalised = pathname.replace(/\/+$/, '') || '/';
  let matched: string | null = null;
  for (const prefix of hidden) {
    if (normalised !== prefix && !normalised.startsWith(`${prefix}/`)) continue;
    if (matched === null || prefix.length > matched.length) matched = prefix;
  }
  return matched;
}

/** Whether a pathname belongs to the developer tooling listed above. */
export function isDeveloperToolPath(pathname: string): boolean {
  return matchedHiddenPath(pathname) !== null;
}

/**
 * The one question both nav and routing ask: given the current deployment
 * mode, may this path be surfaced? `clientFacing` and `allowances` are
 * parameters so tests can exercise the list without stubbing a build.
 */
export function isPathVisibleInDeployment(
  pathname: string,
  clientFacing: boolean,
  allowances: readonly string[] = deploymentAllowances(),
): boolean {
  if (!clientFacing) return true;
  const matched = matchedHiddenPath(pathname);
  return matched === null || allowances.includes(matched);
}
