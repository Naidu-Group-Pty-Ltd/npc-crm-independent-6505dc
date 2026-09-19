/**
 * The picker's one outward dependency, answered from the checked-in fixture.
 *
 * `familyEntries.fixture.json` is sixteen REAL rows of `template_library_entries`
 * (the ten family references, all five Private Banking layouts and two
 * standalone designs, with their production `preview_schema`), so what the
 * harness draws is the catalogue itself, not an impression of it.
 */
import rawEntries from "./familyEntries.fixture.json";

/**
 * The webfont `@import`s are stripped from every preview.
 *
 * A pending render-blocking stylesheet withholds a srcdoc iframe's first
 * paint, and this harness runs where fonts.googleapis.com may be unreachable
 * or slow — the sheets would sit blank for the connection timeout while the
 * layout under test is already finished. Falling back to the system stacks is
 * exactly what a browser with no reach to the CDN does, and the geometry the
 * assertions measure is unaffected.
 */
const entries = (rawEntries as any[]).map((e) => {
  const schema = e.preview_schema;
  if (!schema?.tokens?.fontFaces) return e;
  return { ...e, preview_schema: { ...schema, tokens: { ...schema.tokens, fontFaces: [] } } };
});

const chancery = (entries as any[]).find((e) => e.name === "Chancery");

/** The seeded house master: the global active row Chancery already IS. */
const HOUSE_MASTER = {
  id: "tpl-house",
  name: "Private Banking — Chancery",
  description: "Seeded master.",
  report_type: "investment_compass",
  engine: "weasyprint",
  is_active: true, is_draft: false, is_default: true, scope: "global",
  priority: 0, updated_at: "2026-08-14T00:00:00Z",
  libraryLineage: {
    entryId: chancery?.id, entrySlug: chancery?.slug, entryVersion: chancery?.version,
    familyKey: "private_banking", familyName: "Private Banking", colourway: null,
  },
};

/** A hand-built active row with no lineage — the "Other active templates" case. */
const HAND_BUILT = {
  id: "tpl-hand",
  name: "Bespoke Investment Layout",
  description: "Hand-built template.",
  report_type: "investment_compass",
  engine: "weasyprint",
  is_active: true, is_draft: false, is_default: false, scope: "user",
  priority: 5, updated_at: "2026-08-01T00:00:00Z",
  libraryLineage: null,
};

const params = new URLSearchParams(window.location.search);
const selections = params.get("selected") === "house"
  ? [{ id: "sel-1", report_type: "investment_compass", template_id: "tpl-house" }]
  : [];

export async function invokeSecureFunction(fn: string, payload: any) {
  if (fn === "manage-template-library" && payload?.operation === "list") {
    return { data: { records: entries }, error: null };
  }
  if (fn === "manage-template-library" && payload?.operation === "use_for_reports") {
    return { data: { templateId: "tpl-new", reused: false }, error: null };
  }
  if (payload?.table === "report_templates" && payload?.operation === "list") {
    if (String(payload.listOptions?.select ?? "").includes("previewPage:")) {
      const page = chancery?.preview_schema?.pages?.[0] ?? null;
      return {
        data: {
          records: [{
            id: "tpl-hand",
            previewPage: page,
            previewTokens: chancery?.preview_schema?.tokens ?? {},
          }],
        },
        error: null,
      };
    }
    return { data: { records: [HOUSE_MASTER, HAND_BUILT] }, error: null };
  }
  if (payload?.table === "report_template_selections") {
    if (payload.operation === "list") return { data: { records: selections }, error: null };
    return { data: { records: selections }, error: null };
  }
  return { data: null, error: null };
}
