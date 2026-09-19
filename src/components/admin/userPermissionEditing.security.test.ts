import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source-text contracts (the repo's established *.security.test.ts pattern).
//
// The permission editor used to be hidden on any row that was a superadmin or
// was you: `{!hasSuperadmin && !isSelf && (` wrapped both the Edit and Clone
// buttons. The effect was that the only role allowed to administer permissions
// could not administer its own, and no superadmin's stored grid could be set
// at all — the rows that decide their access the moment the role is removed.
//
// These assertions pin the row's self-guards to the actions that can actually
// strand an account, and keep permission editing out of that set.

const rowSource = readFileSync("src/components/admin/UserTableRow.tsx", "utf8");
const cloneSource = readFileSync("src/components/admin/ClonePermissionsDialog.tsx", "utf8");

describe("permission editing is available on every row", () => {
  it("neither permission action is gated on hasSuperadmin or isSelf", () => {
    // The guard used to wrap three buttons: edit permissions, clone
    // permissions and promote-to-superadmin. Only promote should still carry
    // it — promoting an existing superadmin, or yourself, is meaningless.
    const guarded = rowSource.split("!hasSuperadmin && !isSelf").length - 1;
    expect(guarded, "only the promote button may still be role/self-gated").toBe(1);
    expect(rowSource).toContain("aria-label={`Promote ${u.username} to superadmin`}");

    // Both permission handlers are still wired, just unconditionally.
    expect(rowSource).toContain("onClick={() => onEditPermissions(u.id)}");
    expect(rowSource).toContain("onClick={() => onClonePermissions(u.id)}");
  });

  it("clone offers every account but the source, superadmins included", () => {
    expect(cloneSource).toContain("users.filter(u => u.id !== sourceUserId)");
    expect(cloneSource).not.toContain("r.role === 'superadmin'");
  });
});

describe("the destructive self-guards stay", () => {
  // Deactivating, deleting, demoting or force-logging-out yourself can leave
  // the deployment without a reachable superadmin. Editing a permission grid
  // cannot: the role carries its own access.
  it("keeps isSelf on the actions that can strand an account", () => {
    expect(rowSource).toContain("disabled={isSelf}"); // active toggle
    expect(rowSource).toContain("{hasSuperadmin && !isSelf && ("); // demote
    expect(rowSource).toContain("{!isSelf && onForceLogout && ("); // force logout
    expect(rowSource).toContain("{!hasSuperadmin && !isSelf && ("); // promote
  });
});
