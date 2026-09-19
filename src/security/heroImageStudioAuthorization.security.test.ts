import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "supabase/functions/hero-image-studio/index.ts"),
  "utf8",
);

describe("hero-image-studio authorization contract", () => {
  it("gates report reads and writes before placement queries", () => {
    expect(source).toContain('canAccessReport(supabase, actor, reportId, "can_view")');
    expect(source).toContain('canAccessReport(supabase, actor, reportId, "can_edit")');
    expect(source).toContain('requireModulePermission(supabase, actor, "reports", permission)');
    expect(source).toContain('.eq("generated_by", actor.userId)');

    const readGate = source.indexOf('canAccessReport(supabase, actor, reportId, "can_view")', source.indexOf('action === "placements_list"'));
    const placementRead = source.indexOf('.from("report_hero_placements")', source.indexOf('action === "placements_list"'));
    const writeGate = source.indexOf('canAccessReport(supabase, actor, reportId, "can_edit")', source.indexOf('action === "placement_set"'));
    const placementWrite = source.indexOf('.upsert(row', source.indexOf('action === "placement_set"'));
    expect(readGate).toBeGreaterThan(-1);
    expect(readGate).toBeLessThan(placementRead);
    expect(writeGate).toBeGreaterThan(-1);
    expect(writeGate).toBeLessThan(placementWrite);
  });

  it("requires ownership of a placement library image before upsert", () => {
    const setAction = source.indexOf('action === "placement_set"');
    const ownerGate = source.indexOf('.eq("owner_user_id", userId)', setAction);
    const placementWrite = source.indexOf('.upsert(row', setAction);
    expect(ownerGate).toBeGreaterThan(setAction);
    expect(ownerGate).toBeLessThan(placementWrite);
  });
});
