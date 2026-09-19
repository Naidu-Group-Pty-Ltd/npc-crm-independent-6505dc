/**
 * The names that decide who this deployment IS — and the one rule about them:
 * the Integrations page can never write them.
 *
 * ## Why this exists now
 *
 * `ALLOWED_INTEGRATION_SECRETS` is GENERATED from the Integrations registry, so
 * every credential field anybody adds to a card becomes writable by that page.
 * That is the right default for a vendor key — the page exists so an operator
 * can bring their own Domain key, their own Resend key, their own GHL token.
 *
 * It is the wrong default for a name that is not a vendor key at all. Measured
 * 10 Sep 2026, the generated allow-list of 246 names already carried ELEVEN of
 * the names below:
 *
 *   SUPABASE_ACCESS_TOKEN          a Supabase personal access token, which
 *                                  reaches EVERY project the account owns
 *   MISSION_CONTROL_URL            where this deployment asks about its own
 *   MISSION_CONTROL_CLONE_API_KEY  billing, seats, activation gate and tokens
 *   MISSION_CONTROL_WEBHOOK_SECRET what it trusts a Mission Control call by
 *   TURNSTILE_SECRET_KEY           the twin of this deployment's login widget
 *   STRIPE_SECRET_KEY / _WEBHOOK_SECRET
 *   VERCEL_API_TOKEN / VERCEL_PROJECT_ID
 *   GITHUB_TOKEN / GITHUB_REPOSITORY
 *
 * None of those is a vendor integration. Each answers a question about the
 * deployment's own identity, its hosting, or its relationship with the platform
 * that provisioned it — and writing one from a settings page either escalates
 * (a management token reaches every project) or re-points (a Mission Control
 * URL decides who this workspace believes its billing authority is).
 *
 * The other eight are refused too, and the fact that today's generated list
 * does not carry them is not the reason they are safe. The list is generated
 * from the registry, so a single credential field on a new card adds a name to
 * it — which is exactly how the eleven above got there. A refusal that only
 * covers what is currently reachable would be a snapshot, not a rule.
 *
 * ## Why it matters more from today than it did yesterday
 *
 * Until now this was reachable only by a superadmin ON THE PRIME, because the
 * write path needs a Supabase management token and no clone has one. Opening
 * the brokered write — so a tenant can finally enter a key on their own
 * Integrations page — makes every name in that list tenant-settable unless
 * something refuses it. So this is not defence in depth. It is the control.
 *
 * Mission Control refuses the same classes independently on its own side
 * (`integrationSecretBroker.pure.ts`), because a broker that trusts its
 * caller's validation is not a broker.
 *
 * ## What is refused, and what is deliberately not
 *
 * Refused by exact name or by class: the platform's own runtime wiring, the
 * link to Mission Control, this deployment's hosting and repository
 * credentials, and its login widget's secret half.
 *
 * NOT refused: every ordinary vendor key, including one that supersedes a key
 * the platform forwarded. Superseding is the point — a workspace that brings
 * its own OpenAI key must be able to, and the platform must then stop being
 * charged for it. A rule that blocked that would be protecting the wrong side.
 *
 * Pure: no Deno, so the frontend tests import it too.
 */

/**
 * Exact names the page may never write.
 *
 * Listed rather than pattern-matched wherever a pattern would be a guess about
 * a name nobody has written yet. The prefixes below carry the classes that are
 * genuinely open-ended.
 */
export const DEPLOYMENT_IDENTITY_SECRETS: ReadonlySet<string> = new Set([
  // The platform's own runtime. `SUPABASE_ACCESS_TOKEN` and
  // `SB_MANAGEMENT_ACCESS_TOKEN` are management credentials that reach every
  // project the account owns — including the prime's and Mission Control's.
  'SUPABASE_ACCESS_TOKEN',
  'SB_MANAGEMENT_ACCESS_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'SUPABASE_JWT_SECRET',
  // Who this deployment believes its billing authority is, and what it trusts
  // a call from that authority by.
  'MISSION_CONTROL_URL',
  'MISSION_CONTROL_CLONE_API_KEY',
  'MISSION_CONTROL_WEBHOOK_SECRET',
  // The secret half of this deployment's own login widget. A widget IS a
  // (site key, secret) pair; replacing the secret alone breaks the pairing.
  'TURNSTILE_SECRET_KEY',
  // Hosting and repository. Neither is a vendor integration and both can act
  // on this deployment's own source and its production site.
  'VERCEL_API_TOKEN',
  'VERCEL_PROJECT_ID',
  'VERCEL_TEAM_ID',
  'GITHUB_TOKEN',
  'GITHUB_REPOSITORY',
  // The platform's payment account, not the workspace's.
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  /*
   * Which Anthropic workspace this deployment's model spend is attributed to.
   *
   * Not a credential, and refused for a reason none of the others share: a
   * tenant who could write it would name ANOTHER tenant's workspace and have
   * their model calls billed to that line. Nothing would fail — the calls
   * succeed, the answers are correct, and the only evidence is a figure on
   * somebody else's invoice.
   *
   * It is not on the page's generated allow-list today, because that list is
   * built from the integrations registry rather than from what the runtime
   * reads. This is the rule rather than the accident, so a future card that
   * happens to name the field cannot open it.
   */
  'ANTHROPIC_WORKSPACE_ID',
]);

/**
 * Prefixes whose whole class is refused.
 *
 * `INTERNAL_` is the internal signing family — the secret that makes a
 * scheduled invocation trustworthy. A divergence in one of those is what
 * silently refused 17,174 scheduled AML screening invocations, and letting a
 * settings page write one would make that a supported action.
 */
export const DEPLOYMENT_IDENTITY_PREFIXES: readonly string[] = ['INTERNAL_'];

/** Why a name is refused, in the operator's terms. Null when the page may write it. */
export function deploymentIdentityRefusal(name: string): string | null {
  const matchesPrefix = DEPLOYMENT_IDENTITY_PREFIXES.some((p) => name.startsWith(p));
  if (!DEPLOYMENT_IDENTITY_SECRETS.has(name) && !matchesPrefix) return null;
  return (
    `${name} is part of this deployment's own identity — its Supabase project, its link to ` +
    `Mission Control, its hosting, or the secret half of its login widget — rather than a vendor ` +
    `integration. It is set when the workspace is provisioned and cannot be changed from this ` +
    `page. Vendor keys on this page are yours to set, including ones that supersede a key the ` +
    `platform provided.`
  );
}
