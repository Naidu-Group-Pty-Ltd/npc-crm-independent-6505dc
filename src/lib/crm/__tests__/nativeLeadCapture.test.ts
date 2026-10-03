/**
 * A lead magnet's lead on a native deployment: which client it becomes, which
 * stage it takes, and what it never disturbs.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clientPlacementPatch,
  exactIlikePattern,
  keyColumn,
  LEAD_MAGNET_SOURCE,
  leadMagnetTagName,
  matchClientByEmail,
  newLeadClientRow,
  resolveMagnetStage,
  splitFullName,
} from "../../../../supabase/functions/_shared/crm/nativeLeadCapture.pure";

const magnet = {
  title: "First-home buyer guide",
  ghl_tag: null,
  ghl_pipeline_id: "pipe-key",
  ghl_stage_id: "stage-key",
};
const PIPELINE_ID = "11111111-1111-4111-8111-111111111111";
const STAGE_ID = "22222222-2222-4222-8222-222222222222";
const stage = { id: STAGE_ID, ghl_id: "stage-key", name: "New lead", pipeline_id: PIPELINE_ID };
const pipeline = { id: PIPELINE_ID, ghl_id: "pipe-key" };

describe("which client a lead becomes", () => {
  it("is the one client holding the address, whatever its case", () => {
    expect(
      matchClientByEmail("ada@example.com", [
        { id: "c1", primary_email: " Ada@Example.com " },
        { id: "c2", primary_email: "someone@example.com" },
      ]),
    ).toEqual({ kind: "one", clientId: "c1" });
  });

  it("is nobody where two clients share the address", () => {
    expect(
      matchClientByEmail("ada@example.com", [
        { id: "c1", primary_email: "ada@example.com" },
        { id: "c2", primary_email: "ADA@example.com" },
      ]),
    ).toEqual({ kind: "several", count: 2 });
  });

  it("ignores what a loose search returned that is not the address", () => {
    expect(matchClientByEmail("john_doe@example.com", [{ id: "c1", primary_email: "johnXdoe@example.com" }])).toEqual({
      kind: "none",
    });
  });

  it("searches for the address as written, not as a pattern", () => {
    expect(exactIlikePattern("john_doe%1@x.com")).toBe("john\\_doe\\%1@x.com");
    expect(exactIlikePattern("a\\b@x.com")).toBe("a\\\\b@x.com");
  });
});

describe("a new client", () => {
  it("takes the lead's own details and says where it came from", () => {
    expect(
      newLeadClientRow({ fullName: "  Ada  King Lovelace ", email: "Ada@Example.com", phone: " 0412 345 678 ", magnet }),
    ).toEqual({
      primary_first_name: "Ada",
      primary_surname: "King Lovelace",
      primary_email: "ada@example.com",
      primary_mobile: "0412 345 678",
      lead_source: LEAD_MAGNET_SOURCE,
      lead_source_detail: "First-home buyer guide",
    });
  });

  it("keeps a one-word name and a missing phone as they are", () => {
    expect(splitFullName("Ada")).toEqual({ first: "Ada", surname: "" });
    expect(newLeadClientRow({ fullName: "Ada", email: "a@x.com", phone: null, magnet }).primary_mobile).toBeNull();
  });

  it("is tagged as the vendor path tagged, or with the magnet's own tag", () => {
    expect(leadMagnetTagName(magnet)).toBe("Lead Magnet: First-home buyer guide");
    expect(leadMagnetTagName({ ...magnet, ghl_tag: "  Guide downloads " })).toBe("Guide downloads");
  });
});

describe("the stage a lead takes", () => {
  it("is the stage the magnet names, inside the pipeline it names", () => {
    expect(resolveMagnetStage(magnet, stage, pipeline)).toEqual({
      kind: "stage",
      stage: { id: STAGE_ID, name: "New lead", pipeline_id: PIPELINE_ID },
    });
    expect(
      resolveMagnetStage({ ...magnet, ghl_pipeline_id: PIPELINE_ID, ghl_stage_id: STAGE_ID }, stage, pipeline).kind,
    ).toBe("stage");
  });

  it("is none where the magnet names no stage", () => {
    expect(resolveMagnetStage({ ...magnet, ghl_stage_id: null }, null, null)).toEqual({ kind: "none" });
  });

  it("is refused where the stage belongs to another pipeline, or is not held", () => {
    expect(resolveMagnetStage(magnet, { ...stage, pipeline_id: "other" }, pipeline)).toEqual({ kind: "unknown" });
    expect(resolveMagnetStage(magnet, stage, { ...pipeline, ghl_id: "another-key" })).toEqual({ kind: "unknown" });
    expect(resolveMagnetStage(magnet, null, null)).toEqual({ kind: "unknown" });
  });

  it("is looked up by row id or by stored key, whichever the magnet holds", () => {
    expect(keyColumn(STAGE_ID)).toBe("id");
    expect(keyColumn("stage-key")).toBe("ghl_id");
  });

  it("becomes the client's own only where they had no placement at all", () => {
    expect(clientPlacementPatch({ current_stage_id: null, current_pipeline_id: null }, stage)).toEqual({
      current_stage_id: STAGE_ID,
      current_pipeline_id: PIPELINE_ID,
      pipeline_status: "New lead",
    });
    expect(clientPlacementPatch({ current_stage_id: "s", current_pipeline_id: "p" }, stage)).toBeNull();
    expect(clientPlacementPatch({ current_stage_id: null, current_pipeline_id: "p" }, stage)).toBeNull();
  });
});

describe("request-lead-magnet and fileNativeLead", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
  const read = (path: string) => strip(readFileSync(resolve(__dirname, "../../../../supabase/functions", path), "utf8"));
  const endpoint = read("request-lead-magnet/index.ts");
  const filerModule = read("_shared/crm/fileNativeLead.ts");
  const filer = filerModule.slice(filerModule.indexOf("export async function fileNativeLead("));

  it("files the lead natively before the vendor push, and answers the visitor either way", () => {
    const native = endpoint.indexOf("servingCrmProvider() === 'native'");
    expect(native).toBeGreaterThan(-1);
    expect(native).toBeLessThan(endpoint.indexOf("getGhlCredentials('new')"));
    const branch = endpoint.slice(native, endpoint.indexOf("getGhlCredentials('new')"));
    expect(branch).toContain("await fileNativeLead(");
    expect(branch).not.toContain("leadconnectorhq");
    expect(branch).toContain("catch");
  });

  it("matches on the address the visitor typed, never the de-duplication key", () => {
    const call = endpoint.slice(endpoint.indexOf("await fileNativeLead("));
    expect(call.slice(0, call.indexOf("});"))).toMatch(/email:\s*rawEmail/);
  });

  it("refuses a shared address before writing anything", () => {
    const several = filer.indexOf('match.kind === "several"');
    expect(several).toBeGreaterThan(-1);
    expect(several).toBeLessThan(filer.indexOf('.from("clients").insert('));
    expect(several).toBeLessThan(filer.indexOf("tagClient("));
    expect(several).toBeLessThan(filer.indexOf("placeNativeOpportunity("));
  });

  it("places a client only where they hold no row in that pipeline", () => {
    const check = filer.indexOf('.from("ghl_client_opportunities")');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(filer.indexOf("placeNativeOpportunity(supabase"));
    expect(filer).toContain("(existing ?? []).length === 0");
  });
});
