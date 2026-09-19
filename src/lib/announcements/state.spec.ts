import { describe, expect, it } from "vitest";
import {
  announcementDismissalKey,
  parseAnnouncementsPayload,
  visibleAnnouncements,
  type PlatformAnnouncement,
} from "./state";

const wire = (overrides: Record<string, unknown> = {}) => ({
  id: "a1",
  title: "Scheduled maintenance",
  body: "The platform pauses briefly on Saturday night.",
  linkUrl: null,
  linkLabel: null,
  severity: "info",
  display: "banner",
  dismissible: true,
  revision: 1,
  publishedAt: "2026-09-16T10:00:00Z",
  ...overrides,
});

describe("parseAnnouncementsPayload", () => {
  it("parses a well-formed payload", () => {
    const [a] = parseAnnouncementsPayload({ announcements: [wire()] });
    expect(a.id).toBe("a1");
    expect(a.severity).toBe("info");
    expect(a.display).toBe("banner");
  });

  it("never throws — malformed shapes come back as an empty list", () => {
    expect(parseAnnouncementsPayload(null)).toEqual([]);
    expect(parseAnnouncementsPayload("nope")).toEqual([]);
    expect(parseAnnouncementsPayload({})).toEqual([]);
    expect(parseAnnouncementsPayload({ announcements: "nope" })).toEqual([]);
  });

  it("drops an entry missing its essentials instead of guessing", () => {
    const parsed = parseAnnouncementsPayload({
      announcements: [wire(), { id: "broken" }, 42, null, wire({ id: "a2" })],
    });
    expect(parsed.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("degrades unknown severity and display to an info banner", () => {
    const [a] = parseAnnouncementsPayload({
      announcements: [wire({ severity: "apocalyptic", display: "jumbotron" })],
    });
    expect(a.severity).toBe("info");
    expect(a.display).toBe("banner");
  });

  it("forces a modal dismissible — an uncloseable modal is a lock screen", () => {
    const [a] = parseAnnouncementsPayload({
      announcements: [wire({ display: "modal", dismissible: false })],
    });
    expect(a.dismissible).toBe(true);
  });

  it("admits only https links, and a label only where a link is", () => {
    const [insecure] = parseAnnouncementsPayload({
      announcements: [wire({ linkUrl: "http://example.com", linkLabel: "x" })],
    });
    expect(insecure.linkUrl).toBeNull();
    expect(insecure.linkLabel).toBeNull();

    const [secure] = parseAnnouncementsPayload({
      announcements: [wire({ linkUrl: "https://example.com" })],
    });
    expect(secure.linkLabel).toBe("https://example.com");
  });

  it("floors a nonsense revision at 1", () => {
    const [a] = parseAnnouncementsPayload({
      announcements: [wire({ revision: -3 })],
    });
    expect(a.revision).toBe(1);
  });
});

describe("dismissals", () => {
  it("keys per (id, revision), so a re-raise mints a new key and re-pops", () => {
    const r1 = announcementDismissalKey({ id: "a1", revision: 1 });
    const r2 = announcementDismissalKey({ id: "a1", revision: 2 });
    expect(r1).not.toBe(r2);
  });

  it("hides dismissed entries and shows at most ONE modal at a time", () => {
    const list = parseAnnouncementsPayload({
      announcements: [
        wire({ id: "b1" }),
        wire({ id: "b2" }),
        wire({ id: "m1", display: "modal" }),
        wire({ id: "m2", display: "modal" }),
      ],
    }) as PlatformAnnouncement[];

    const dismissed = new Set([announcementDismissalKey({ id: "b1", revision: 1 })]);
    const visible = visibleAnnouncements(list, (k) => dismissed.has(k));

    expect(visible.banners.map((a) => a.id)).toEqual(["b2"]);
    // Two live modals, one shown — a queue of popups is a hostage situation.
    expect(visible.modal?.id).toBe("m1");
  });
});
