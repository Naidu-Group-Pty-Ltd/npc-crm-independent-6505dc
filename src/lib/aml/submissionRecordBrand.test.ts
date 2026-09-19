import { describe, expect, it } from "vitest";

import {
  AURIXA_FALLBACK_NAME,
  loadRecordBrandLogo,
  resolveRecordBrand,
} from "./submissionRecordBrand";

/**
 * The white-label identity a record PDF is issued under. What is pinned:
 * a configured brand wins; an unconfigured workspace falls back to Aurixa
 * Systems (never an empty masthead); the colour ramp is the shared
 * `getBrandPdfPalette` resolver so the record matches the tenant's other
 * documents; and the logo loader degrades to null — the wordmark — on
 * anything it cannot embed.
 */

const NO_LOGOS = {
  authLogo: null, sidebarLogo: null, sidebarIcon: null,
  favicon: null, reportLogo: null, reportMonoLogo: null,
};

describe("who issues the document", () => {
  it("a configured brand issues under its own name and colour", () => {
    const brand = resolveRecordBrand({ companyName: "NPC Services", brandColor: "217 91% 40%" });
    expect(brand.name).toBe("NPC Services");
    expect(brand.tenantBranded).toBe(true);
    // The ramp is derived from the tenant hue via the shared resolver —
    // a blue brand colour must not come back as the default gold.
    expect(brand.accent.toLowerCase()).not.toBe(resolveRecordBrand({ companyName: "X", brandColor: null }).accent.toLowerCase());
  });

  it("no brand configured falls back to Aurixa Systems, never an empty masthead", () => {
    for (const companyName of ["", "  ", "Dashboard", "dashboard"]) {
      const brand = resolveRecordBrand({ companyName, brandColor: null });
      expect(brand.name).toBe(AURIXA_FALLBACK_NAME);
      expect(brand.tenantBranded).toBe(false);
    }
  });

  it("the fallback keeps a full accent ramp and a dark ground", () => {
    const brand = resolveRecordBrand({ companyName: null as unknown as string, brandColor: null });
    for (const hex of [brand.accent, brand.accentDeep, brand.accentLight, brand.accentPale, brand.ground]) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("the fallback wears the Passport navy and names itself beside the emblem", () => {
    const fallback = resolveRecordBrand({ companyName: "", brandColor: null });
    const tenant = resolveRecordBrand({ companyName: "NPC Services", brandColor: null });
    // The navy is Aurixa's — a tenant brand keeps the neutral obsidian.
    expect(fallback.ground).not.toBe(tenant.ground);
    // The delta emblem carries no name; a tenant's report logo is a lockup.
    expect(fallback.wordmarkBesideLogo).toBe(true);
    expect(tenant.wordmarkBesideLogo).toBe(false);
  });
});

describe("the logo is embedded or absent, never broken", () => {
  it("no configured asset resolves to the wordmark", async () => {
    expect(await loadRecordBrandLogo(NO_LOGOS)).toBeNull();
  });

  it("a raster data URL passes through untouched", async () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(await loadRecordBrandLogo({ ...NO_LOGOS, reportLogo: png })).toBe(png);
  });

  it("a non-raster mark degrades to the wordmark — jsPDF cannot draw an SVG", async () => {
    const svg = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
    expect(await loadRecordBrandLogo({ ...NO_LOGOS, reportLogo: svg })).toBeNull();
  });
});
