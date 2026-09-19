import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "supabase/functions/prepare-report-hero-images/index.ts"),
  "utf8",
);

describe("prepare-report-hero-images authorization contract", () => {
  it("requires report module permission and ownership before service-role report access", () => {
    expect(source).toContain('requireModulePermission(supabase, actor, "reports", permission)');
    expect(source).toContain('.eq("generated_by", actor.userId)');
    expect(source).toContain('action === "status" || action === "list" ? "can_view" : "can_edit"');

    const requestGate = source.indexOf("if (!await canAccessReport(supabase, actor, reportId, permission))");
    const enqueue = source.indexOf('if (action === "enqueue")');
    const assetRead = source.indexOf('.from("report_visual_assets")', enqueue);

    expect(requestGate).toBeGreaterThan(-1);
    expect(requestGate).toBeLessThan(enqueue);
    expect(requestGate).toBeLessThan(assetRead);
  });
});
