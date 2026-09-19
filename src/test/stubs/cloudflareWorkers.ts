/**
 * `cloudflare:workers`, for the test environment only.
 *
 * The Workers runtime provides this module; Vite cannot resolve the specifier
 * and fails collection for any test that reaches it, the same way `unpdf` and
 * `djwt` do — see the alias block in `vitest.config.ts`.
 *
 * `DurableObject` is a base class the runtime supplies purely to hold `ctx`
 * and `env`. Standing in for it lets the REAL `PdfElection` be constructed and
 * driven by tests: the platform is stubbed, never the subject. Nothing here
 * emulates Durable Object behaviour — storage, alarms and RPC are deliberately
 * absent, so a test that depended on them would fail rather than pass against
 * a fiction.
 */
export class DurableObject<Env = unknown> {
  readonly ctx: DurableObjectState;
  readonly env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

/** Only the shape the election object touches: it never uses storage. */
export interface DurableObjectState {
  storage: unknown;
}
