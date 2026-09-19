import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A component is not shipped until something renders it — this repository's
 * own rule, learned when three builder-portal components merged, deployed
 * and rendered nowhere. This spec pins the announcement chain end to end at
 * the source level, because every link in it fails silent by design and a
 * broken link would therefore report as "no announcements" forever:
 *
 *   DashboardLayout mounts AnnouncementHost (both chrome branches)
 *   → the client invokes the `mission-control-announcements` function
 *   → that function exists and is declared in config.toml
 *     (an OMITTED block is read as verify_jwt = true, which would 401 the
 *     browser's call at the gateway while looking exactly like a quiet day).
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the announcement channel is actually wired", () => {
  it("DashboardLayout renders AnnouncementHost in BOTH chrome branches", () => {
    const layout = read("src/components/layout/DashboardLayout.tsx");
    expect(layout).toContain(
      "import { AnnouncementHost } from '@/components/announcements/AnnouncementHost'",
    );
    const mounts = layout.match(/<AnnouncementHost \/>/g) ?? [];
    expect(mounts.length).toBeGreaterThanOrEqual(2);
  });

  it("the frontend client invokes the broker function by its deployed name", () => {
    const client = read("src/lib/announcements/client.ts");
    expect(client).toContain('"mission-control-announcements"');
    expect(client).toContain("invokeSecureFunction");
  });

  it("the broker function exists and reads Mission Control, never Airtable-style literals", () => {
    const fn = read("supabase/functions/mission-control-announcements/index.ts");
    expect(fn).toContain("fetchAnnouncementsFromMissionControl");
    const shared = read("supabase/functions/_shared/announcements.ts");
    expect(shared).toContain("MISSION_CONTROL_URL");
    expect(shared).toContain("MISSION_CONTROL_CLONE_API_KEY");
    expect(shared).toContain("/api/public/clones/announcements");
  });

  it("config.toml declares the function with verify_jwt = false, like its gate sibling", () => {
    const toml = read("supabase/config.toml");
    const m = toml.match(
      /\[functions\.mission-control-announcements\]\s*\nverify_jwt = (\w+)/,
    );
    expect(m?.[1]).toBe("false");
  });

  it("the host sits in the banner strip beside the gate banner, not off in dead code", () => {
    const layout = read("src/components/layout/DashboardLayout.tsx");
    for (const m of layout.matchAll(/<PaymentGateBanner \/>\s*\n\s*(<\w+)/g)) {
      expect(m[1]).toBe("<AnnouncementHost");
    }
  });
});
