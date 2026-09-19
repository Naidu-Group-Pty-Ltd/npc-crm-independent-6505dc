import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Repo-relative, like every other source-text contract here. It was an
// `import.meta.url` URL, which this vitest config does not resolve to a file
// scheme — the suite threw on import and the contract went unenforced.
const guardSource = readFileSync("src/components/auth/ModuleGuard.tsx", "utf8");

describe("module route entitlement contract", () => {
  it("uses the combined user-permission and workspace-plan hook", () => {
    expect(guardSource).toContain("useModulePermissions(moduleKey)");
    expect(guardSource).not.toContain("usePermissions()");
  });

  it("says so on the page when only the operator override opened the module", () => {
    // A superadmin reaching an unbought module must be able to tell their own
    // view from the customer's — otherwise the bypass answers support tickets
    // with advice that cannot be followed.
    expect(guardSource).toContain("decision?.operatorOnly");
  });
});
