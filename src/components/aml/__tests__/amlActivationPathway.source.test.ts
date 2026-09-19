import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs from the repo root; jsdom rewrites import.meta.url to an http
// scheme, so resolve the sources from the working directory instead.
const repo = process.cwd();
const read = (p: string) => readFileSync(join(repo, p), "utf8");

const MIGRATION_PATH = "supabase/migrations/20260804160000_aml_activate_inactive_client.sql";
const ATOMIC_AUDIT_MIGRATION_PATH =
  "supabase/migrations/20260815135258_c6cfab57-c04d-483a-9906-c31550a23e5a.sql";
const OLD_FUTURE_DATED_MIGRATION_PATH =
  "supabase/migrations/20260826000000_aml_activate_inactive_client.sql";

const edgeSource = read("supabase/functions/aml-cases/index.ts");
const migrationSource = read(MIGRATION_PATH);
const atomicAuditMigrationSource = read(ATOMIC_AUDIT_MIGRATION_PATH);
const amlCasesPage = read("src/pages/aml/AmlCases.tsx");
const dialogSource = read("src/components/aml/ActivateClientDialog.tsx");
const activateAction = read("src/components/clients/ClientAmlActivateAction.tsx");
const summaryCard = read("src/components/clients/ClientAmlSummaryCard.tsx");
const clientManagement = read("src/pages/ClientManagement.tsx");

describe("AML activation pathway — server contract", () => {
  it("no longer rejects inactive clients from activation", () => {
    expect(edgeSource).not.toContain("Client is not active; cannot activate for AML");
    expect(edgeSource).toContain("const clientWasInactive = client.is_active !== true;");
  });

  it("activates an inactive client exclusively through the transactional RPC", () => {
    const inactiveBranch = edgeSource.slice(
      edgeSource.indexOf("if (clientWasInactive) {"),
      edgeSource.indexOf("} else {", edgeSource.indexOf("if (clientWasInactive) {")),
    );
    expect(inactiveBranch).toContain("admin.rpc(");
    expect(inactiveBranch).toContain("'aml_activate_client_open_case'");
    // No direct writes on this path: the flip and the insert happen only
    // inside the RPC's transaction.
    expect(inactiveBranch).not.toContain(".update(");
    expect(inactiveBranch).not.toContain(".insert(");
    expect(inactiveBranch).not.toContain("appendEvent(");
  });

  it("fails closed with a 503 configuration error when the RPC is not installed", () => {
    const inactiveBranch = edgeSource.slice(
      edgeSource.indexOf("if (clientWasInactive) {"),
      edgeSource.indexOf("} else {", edgeSource.indexOf("if (clientWasInactive) {")),
    );
    expect(inactiveBranch).toContain("isMissingFunctionError(txErr)");
    expect(inactiveBranch).toContain(
      "error: 'AML client activation is temporarily unavailable because the required database function has not been installed.',",
    );
    expect(inactiveBranch).toContain("code: 'aml_activation_rpc_unavailable',");
    expect(inactiveBranch).toContain("}, 503);");
    // The 503 must not swallow genuine failures: duplicate and not-found
    // mappings survive, and everything else still throws.
    expect(inactiveBranch).toContain("An open AML case already exists for this client");
    expect(inactiveBranch).toContain("txErr.code === 'P0002'");
    expect(inactiveBranch).toContain("throw txErr;");
  });

  it("contains no compensated flip/insert/revert fallback anywhere", () => {
    // The old fallback flipped is_active outside a transaction and tried to
    // revert it on failure — racy (a concurrent activation's committed case
    // could get its client flipped back to inactive) and the revert itself
    // could fail. It must not exist in any form.
    expect(edgeSource).not.toContain(".update({ is_active: true })");
    expect(edgeSource).not.toContain(".update({ is_active: false })");
    expect(edgeSource).not.toMatch(/update\(\s*\{\s*is_active/);
    expect(edgeSource).not.toContain("fallbackCreated");
  });

  it("keeps the existing direct case-creation path for already-active clients", () => {
    const activeBranch = edgeSource.slice(
      edgeSource.indexOf("// Already-active client: existing case-creation behaviour unchanged."),
      edgeSource.indexOf("const clientActivation = {"),
    );
    expect(activeBranch).toContain(".insert({ ...baseInsert, ...dimensionFields }).select('*').single()");
    expect(activeBranch).toContain("isMissingColumnError(createErr)");
    expect(activeBranch).toContain("An open AML case already exists for this client");
    expect(activeBranch).not.toContain("admin.rpc(");
  });

  it("the migration performs the flip and the insert inside a single function (one transaction)", () => {
    expect(migrationSource).toContain("CREATE OR REPLACE FUNCTION public.aml_activate_client_open_case");
    expect(migrationSource).toContain("FOR UPDATE");
    expect(migrationSource).toContain("SET is_active = true");
    expect(migrationSource).toContain("INSERT INTO aml.cases");
    // Service-role only; never callable directly from the browser roles.
    expect(migrationSource).toContain("REVOKE ALL ON FUNCTION public.aml_activate_client_open_case(uuid, jsonb) FROM authenticated");
    expect(migrationSource).toContain("GRANT EXECUTE ON FUNCTION public.aml_activate_client_open_case(uuid, jsonb) TO service_role");
  });

  it("writes the required activation audit event inside the inactive-client transaction", () => {
    expect(atomicAuditMigrationSource).toContain("INSERT INTO aml.case_events");
    expect(atomicAuditMigrationSource).toContain("activation_audit_event");
    expect(edgeSource).toContain("activation_audit_event: activationAuditEvent");
    expect(edgeSource).toContain("if (!clientWasInactive) {");
  });

  it("reconciles an exact retry but still rejects a different duplicate activation", () => {
    const activateBlock = edgeSource.slice(
      edgeSource.indexOf("case 'activate_client'"),
      edgeSource.indexOf("case 'update'"),
    );
    expect(activateBlock).toContain("const isSameConfirmedActivation");
    expect(activateBlock).toContain("reconciled: true");
    expect(activateBlock).toContain("An open AML case already exists for this client");
  });

  it("keeps duplicate-open-case prevention on every creation path", () => {
    // Pre-check…
    expect(edgeSource).toContain("Duplicate-open guard: one open case per client at a time.");
    // …and the unique-index race backstop surfaces as the same 409 on the
    // active path, the RPC path and the fallback path.
    const occurrences = edgeSource.split("An open AML case already exists for this client").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });

  it("gates activation, search and the route-handoff lookup behind AML write roles", () => {
    const activateBlock = edgeSource.slice(
      edgeSource.indexOf("case 'activate_client'"),
      edgeSource.indexOf("case 'update'"),
    );
    expect(activateBlock).toContain("if (!canCreate) return jsonResponse({ error: 'Analyst or MLRO role required' }, 403);");
    const searchBlock = edgeSource.slice(
      edgeSource.indexOf("case 'search_clients'"),
      edgeSource.indexOf("case 'get_client_for_activation'"),
    );
    expect(searchBlock).toContain("if (!canWrite) return jsonResponse({ error: 'Insufficient permissions' }, 403);");
    const lookupBlock = edgeSource.slice(
      edgeSource.indexOf("case 'get_client_for_activation'"),
      edgeSource.indexOf("case 'client_summary'"),
    );
    expect(lookupBlock).toContain("if (!canWrite) return jsonResponse({ error: 'Insufficient permissions' }, 403);");
    expect(lookupBlock).toContain("return jsonResponse({ error: 'Client not found' }, 404);");
  });

  it("search reads only the canonical clients table and returns inactive clients too", () => {
    const searchBlock = edgeSource.slice(
      edgeSource.indexOf("case 'search_clients'"),
      edgeSource.indexOf("case 'get_client_for_activation'"),
    );
    expect(searchBlock).toContain(".from('clients')");
    expect(searchBlock).not.toContain("marketing");
    expect(searchBlock).not.toMatch(/filter\(.*is_active === true\)\.slice/);
    // Matching is the pure module's job either way — the op must not grow a
    // hand-rolled copy of the all-tokens-on-one-person rule.
    expect(searchBlock).toContain("selectActivationPage");
  });

  /**
   * Browse mode. The picker used to answer `{ clients: [] }` below two
   * characters, so an operator had to already know a client's name — and
   * spell it — before the system would admit the client existed. Browsing is
   * the same op, projection and permission gate; only the filter differs.
   * A separate "list clients" endpoint would be a second source of truth
   * about which clients an AML operator may see, and the two would drift.
   */
  it("browses the register instead of answering nothing to an empty query", () => {
    const searchBlock = edgeSource.slice(
      edgeSource.indexOf("case 'search_clients'"),
      edgeSource.indexOf("case 'get_client_for_activation'"),
    );
    // The browse/search decision is made in one place, shared with the tests.
    expect(searchBlock).toContain("isBrowseQuery");
    // The old early return is gone.
    expect(searchBlock).not.toMatch(/q\.length < 2.*return jsonResponse\(\{ clients: \[\] \}\)/s);
    // Paging is done by the database on the browse path, not by pulling the
    // whole register into memory to sort it.
    expect(searchBlock).toContain(".range(offset, offset + limit - 1)");
    expect(searchBlock).toContain("count: 'exact'");
    // A nullable `is_active` is not active — the inactive slice must include
    // nulls, or those rows appear in neither tab and read as missing clients.
    expect(searchBlock).toContain("is_active.eq.false,is_active.is.null");
  });

  it("browse is gated and projected exactly like search", () => {
    const searchBlock = edgeSource.slice(
      edgeSource.indexOf("case 'search_clients'"),
      edgeSource.indexOf("case 'get_client_for_activation'"),
    );
    // One permission check covers both paths — it is above the branch.
    const gate = searchBlock.indexOf("if (!canWrite)");
    const branch = searchBlock.indexOf("if (browsing)");
    expect(gate).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(gate);
    // One projection covers both paths: identification only, never financials.
    expect(searchBlock).not.toMatch(/select\(['"`][^'"`]*(portfolio|income|debt|cash_flow)/);
    const selects = searchBlock.match(/\.select\(CLIENT_SEARCH_SELECT\)/g) ?? [];
    expect(selects.length).toBeGreaterThanOrEqual(2);
  });
});

describe("AML activation pathway — migration filename", () => {
  it("the migration exists under a repository-consistent, non-future timestamp", () => {
    expect(existsSync(join(repo, MIGRATION_PATH))).toBe(true);
    // Sorts after the AML dependencies it builds on (aml.cases 20260716…,
    // workflow dimensions 20260725153000) and after the other 20260804
    // migrations already in the repo.
    const version = "20260804160000";
    expect(MIGRATION_PATH).toContain(version);
    expect(version > "20260725153000").toBe(true);
  });

  it("the old future-dated filename is gone and nothing references it", () => {
    expect(existsSync(join(repo, OLD_FUTURE_DATED_MIGRATION_PATH))).toBe(false);
    // No source or test (other than this guard's own constant) may point at
    // the removed filename.
    for (const p of [
      "supabase/functions/aml-cases/index.ts",
      "src/lib/aml/amlPortalContracts.test.ts",
      "src/lib/aml/amlClientSearch.test.ts",
      "src/components/aml/__tests__/activateClientDialog.test.tsx",
      "src/components/aml/ActivateClientDialog.tsx",
    ]) {
      expect(read(p)).not.toContain("20260826000000");
    }
  });
});

describe("AML activation pathway — route handoff", () => {
  it("the AML Cases page reads activateClientId and preselects the dialog with it", () => {
    expect(amlCasesPage).toContain('searchParams.get("activateClientId")');
    expect(amlCasesPage).toContain("clientId={activateClientId ?? undefined}");
    // Param is removed once the flow completes or the dialog closes.
    expect(amlCasesPage).toContain('next.delete("activateClientId")');
  });

  it("navigation to the activation route carries the client ID only — no personal information", () => {
    for (const source of [activateAction, summaryCard]) {
      const urls = source.match(/\/admin\/aml\/cases\?activateClientId=\$\{clientId\}/g) ?? [];
      expect(urls.length).toBeGreaterThan(0);
      // No name/email/status interpolation anywhere near the route.
      expect(source).not.toMatch(/activateClientId=\$\{clientId\}[^`]*(name|email|mobile|active)/i);
      expect(source).not.toMatch(/activateClient(Name|Email)/);
    }
  });

  it("the dialog loads the route-selected client server-side and never trusts a caller-supplied name", () => {
    expect(dialogSource).toContain("amlCasesApi.getClientForActivation(clientId)");
    expect(dialogSource).toContain("setDisplayName(res.client.label)");
    expect(dialogSource).not.toContain("Mark the client active on their record first");
  });

  it("the client-details action is not gated behind the startClientCompliance rollout flag", () => {
    // Only the caseWorkspace flag is consumed (for case navigation) — the
    // rollout flag never gates this action's visibility.
    expect(activateAction).toContain("const { caseWorkspace } = useAmlV3Flags();");
    expect(activateAction).not.toMatch(/startClientCompliance\s*[}&|?)]/);
    expect(activateAction).toContain("access.canWrite");
    expect(activateAction).toContain("access.flagEnabled");
    expect(activateAction).toContain('"Open AML Case"');
    expect(activateAction).toContain('isActive === true ? "Start AML/CTF" : "Activate for AML/CTF"');
  });
});

describe("Client data contract", () => {
  it("keeps favourite status and active status as separate concepts", () => {
    // The starred filter reads is_favorite; nothing maps it onto is_active.
    expect(clientManagement).toContain("is_favorite?: boolean");
    expect(clientManagement).toContain("is_active?: boolean | null");
    expect(clientManagement).not.toMatch(/is_active[^\n]*=\s*[^\n]*is_favorite/);
    expect(clientManagement).not.toMatch(/is_favorite[^\n]*as active status/i);
  });
});

describe("AML case actor identity — canonical Command Centre users (hotfix)", () => {
  const ACTOR_FK_MIGRATION_PATH =
    "supabase/migrations/20260804190000_aml_case_actor_fkeys_custom_users.sql";
  const actorFkMigration = read(ACTOR_FK_MIGRATION_PATH);
  const authSource = read("supabase/functions/_shared/auth.ts");

  it("verifyAuth resolves Command Centre users against public.custom_users", () => {
    // Session tokens resolve via user_sessions (custom auth) and JWT subs are
    // confirmed against custom_users — the returned userId IS a
    // custom_users.id, which is what the case actor columns store.
    expect(authSource).toContain(".from('custom_users')");
    expect(authSource).toContain(".from('user_sessions')");
  });

  it("case creation stamps the authenticated analyst as owner and creator", () => {
    const activateBranch = edgeSource.slice(
      edgeSource.indexOf("case 'activate_client'"),
      edgeSource.indexOf("case 'update'"),
    );
    expect(activateBranch).toContain("assigned_analyst_id: userId,");
    expect(activateBranch).toContain("created_by: userId,");
    // Accountability is never dropped to dodge the FK.
    expect(activateBranch).not.toContain("assigned_analyst_id: null");
    expect(activateBranch).not.toContain("created_by: null");
  });

  it("a service-role caller can never be stored as the analyst", () => {
    // Rejected at authentication, before any op (including case writes) runs.
    const authGate = edgeSource.indexOf("auth.userId === 'service_role'");
    const firstOp = edgeSource.indexOf("switch (op)");
    expect(authGate).toBeGreaterThan(-1);
    expect(authGate).toBeLessThan(firstOp);
  });

  it("the hotfix migration retargets all three actor FKs at public.custom_users(id)", () => {
    expect(existsSync(join(repo, ACTOR_FK_MIGRATION_PATH))).toBe(true);
    for (const col of ["assigned_analyst_id", "assigned_mlro_id", "created_by"]) {
      expect(actorFkMigration).toContain(
        `ADD CONSTRAINT cases_${col}_fkey`);
      expect(actorFkMigration).toContain(
        `FOREIGN KEY (${col}) REFERENCES public.custom_users(id)`);
      expect(actorFkMigration).toContain(
        `DROP CONSTRAINT IF EXISTS cases_${col}_fkey`);
    }
    // The wrong target is gone entirely — nothing re-adds auth.users.
    expect(actorFkMigration).not.toMatch(/REFERENCES\s+auth\.users/);
  });

  it("the migration keeps FK enforcement — every drop is paired with a recreate", () => {
    const drops = actorFkMigration.match(/DROP CONSTRAINT IF EXISTS cases_\w+_fkey/g) ?? [];
    const adds = actorFkMigration.match(/ADD CONSTRAINT cases_\w+_fkey/g) ?? [];
    expect(drops.length).toBe(3);
    expect(adds.length).toBe(3);
    expect(actorFkMigration).not.toMatch(/DISABLE TRIGGER|NOT VALID/);
  });

  it("the migration fails clearly on orphaned actor ids instead of dropping data", () => {
    expect(actorFkMigration).toContain("RAISE EXCEPTION");
    expect(actorFkMigration).toMatch(/NOT EXISTS \(\s*\n?\s*SELECT 1 FROM public\.custom_users/);
    expect(actorFkMigration).not.toMatch(/DELETE FROM|UPDATE aml\.cases/);
  });
});
