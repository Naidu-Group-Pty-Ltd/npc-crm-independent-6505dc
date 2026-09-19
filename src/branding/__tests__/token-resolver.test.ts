import { describe, it, expect } from "vitest";
import { resolveBrandTokens } from "../token-resolver";
import { defaultBrandConfig, defaultDarkTokenMap, defaultLightTokenMap, DEFAULT_PRIMARY, LIGHT_DEFAULT_PRIMARY } from "../brand-defaults";
import type { BrandConfig } from "../brand-types";


const protectedLightSurfaceTokens = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--secondary",
  "--muted",
  "--muted-foreground",
  "--border",
  "--input",
  "--sidebar-background",
  "--sidebar-foreground",
  "--sidebar-border",
  "--dashboard-surface",
  "--dashboard-surface-elevated",
  "--dashboard-surface-muted",
  "--dashboard-border-soft",
  "--dashboard-border-strong",
  "--surface-1",
  "--surface-2",
  "--surface-3",
  "--surface-elevated",
  "--surface-muted",
  "--border-soft",
  "--border-strong",
  "--topbar-background",
  "--sidebar-surface",
  "--mobile-nav-background",
] as const;

const brandableLightTokens = [
  "--primary",
  "--primary-hover",
  "--accent",
  "--ring",
  "--sidebar-primary",
  "--sidebar-accent",
  "--sidebar-ring",
  "--dashboard-primary-strong",
  "--dashboard-primary-soft",
] as const;


describe("resolveBrandTokens", () => {
  it("emits both light and dark token maps", () => {
    const tokens = resolveBrandTokens(defaultBrandConfig);
    expect(tokens.light).toBeDefined();
    expect(tokens.dark).toBeDefined();
  });

  it("falls back to default primary when none provided", () => {
    const tokens = resolveBrandTokens(defaultBrandConfig);
    expect(tokens.light["--primary"]).toBe(LIGHT_DEFAULT_PRIMARY);
    expect(tokens.dark["--primary"]).toBe(DEFAULT_PRIMARY);
  });

  it("uses provided primary color in both themes", () => {
    const config: BrandConfig = {
      ...defaultBrandConfig,
      primaryColor: "210 80% 50%",
    };
    const tokens = resolveBrandTokens(config);
    expect(tokens.light["--primary"]).toBe("210 80% 50%");
    expect(tokens.dark["--primary"]).toBe("210 80% 50%");
  });

  it("falls back safely when persisted brand colors are not strings", () => {
    const malformedConfig = {
      ...defaultBrandConfig,
      brandColor: { attacker: true },
    } as unknown as BrandConfig;

    expect(() => resolveBrandTokens(malformedConfig)).not.toThrow();

    const tokens = resolveBrandTokens(malformedConfig);
    expect(tokens.light["--brand"]).toBe(defaultLightTokenMap["--brand"]);
    expect(tokens.dark["--brand"]).toBe(defaultDarkTokenMap["--brand"]);
  });

  it("derives a chart palette of 10 entries", () => {
    const tokens = resolveBrandTokens(defaultBrandConfig);
    for (let i = 1; i <= 10; i++) {
      expect(tokens.light[`--chart-${i}` as `--chart-${number}`]).toBeTruthy();
      expect(tokens.dark[`--chart-${i}` as `--chart-${number}`]).toBeTruthy();
    }
  });

  it("produces accessible primary foreground", () => {
    const config: BrandConfig = {
      ...defaultBrandConfig,
      primaryColor: "0 0% 5%",
    };
    const tokens = resolveBrandTokens(config);
    // Dark primary should pair with light foreground
    expect(tokens.light["--primary-foreground"]).toMatch(/100%|95%|90%/);
  });

  it("includes all critical semantic tokens", () => {
    const tokens = resolveBrandTokens(defaultBrandConfig);
    const required = [
      "--background",
      "--foreground",
      "--card",
      "--popover",
      "--primary",
      "--accent",
      "--muted",
      "--border",
      "--ring",
      "--success",
      "--warning",
      "--destructive",
      "--info",
      "--sidebar-background",
      "--surface-1",
      "--surface-elevated",
    ];
    for (const token of required) {
      expect(tokens.light[token as `--${string}`]).toBeTruthy();
      expect(tokens.dark[token as `--${string}`]).toBeTruthy();
    }
  });

  it("produces stable snapshot for default config", () => {
    const tokens = resolveBrandTokens(defaultBrandConfig);
    expect(tokens.light["--primary"]).toMatchInlineSnapshot(`"262 66% 46%"`);
    expect(tokens.dark["--primary"]).toMatchInlineSnapshot(`"43 74% 49%"`);
    expect(tokens.light["--success"]).toMatchInlineSnapshot(`"142 71% 45%"`);
    expect(tokens.dark["--destructive"]).toMatchInlineSnapshot(`"0 84% 60%"`);
  });

  it("keeps light surfaces stable when custom brand colours are selected", () => {
    const config: BrandConfig = {
      ...defaultBrandConfig,
      primaryColor: "285 90% 45%",
      accentColor: "205 95% 45%",
    };
    const tokens = resolveBrandTokens(config);

    for (const token of protectedLightSurfaceTokens) {
      expect(tokens.light[token]).toBe(defaultLightTokenMap[token]);
    }
  });

  it("limits custom brand colours to approved light semantic emphasis tokens", () => {
    const config: BrandConfig = {
      ...defaultBrandConfig,
      primaryColor: "285 90% 45%",
      accentColor: "205 95% 45%",
    };
    const tokens = resolveBrandTokens(config);

    expect(tokens.light["--primary"]).toBe("285 90% 45%");
    expect(tokens.light["--accent"]).toBe("205 95% 45%");
    expect(tokens.light["--ring"]).toBe("285 90% 45%");
    expect(tokens.light["--sidebar-primary"]).toBe("285 90% 45%");
    expect(tokens.light["--sidebar-accent"]).toBe("205 95% 45%");
    expect(tokens.light["--dashboard-primary-strong"]).toBe("285 90% 45%");
    expect(tokens.light["--chart-1"]).toBe(defaultLightTokenMap["--chart-1"]);
    expect(tokens.light["--chart-2"]).toBe(defaultLightTokenMap["--chart-2"]);

    for (const token of brandableLightTokens) {
      expect(tokens.light[token]).toBeTruthy();
    }
  });

  it("uses a soft readable light brand wash instead of a saturated dashboard surface wash", () => {
    const config: BrandConfig = {
      ...defaultBrandConfig,
      primaryColor: "285 90% 45%",
      accentColor: "205 95% 45%",
    };
    const tokens = resolveBrandTokens(config);

    expect(tokens.light["--dashboard-primary-soft"]).toBe("285 29% 90%");
    expect(tokens.light["--dashboard-primary-soft"]).not.toBe("285 90% 90%");
    expect(tokens.light["--background"]).toBe(defaultLightTokenMap["--background"]);
    expect(tokens.light["--card"]).toBe(defaultLightTokenMap["--card"]);
    expect(tokens.light["--success"]).toBe(defaultLightTokenMap["--success"]);
    expect(tokens.light["--warning"]).toBe(defaultLightTokenMap["--warning"]);
    expect(tokens.light["--destructive"]).toBe(defaultLightTokenMap["--destructive"]);
  });

  it("keeps dark surface defaults separate from the luxury light baseline", () => {
    const config: BrandConfig = {
      ...defaultBrandConfig,
      primaryColor: "285 90% 45%",
      accentColor: "205 95% 45%",
    };
    const tokens = resolveBrandTokens(config);
    const darkSurfaceTokens = [
      "--background",
      "--foreground",
      "--card",
      "--popover",
      "--muted",
      "--border",
      "--input",
      "--sidebar-background",
      "--dashboard-surface",
      "--dashboard-surface-elevated",
      "--dashboard-surface-muted",
      "--topbar-background",
      "--sidebar-surface",
      "--mobile-nav-background",
    ] as const;

    for (const token of darkSurfaceTokens) {
      expect(tokens.dark[token]).toBe(defaultDarkTokenMap[token]);
      expect(tokens.dark[token]).not.toBe(defaultLightTokenMap[token]);
    }
  });
});
