import { describe, expect, it } from "vitest";
import {
  firstPageUrl,
  graphDateTimeOffset,
} from "../../../../supabase/functions/_shared/graphMailPaging";

/*
  THE BACKFILL BOUNDARY GOES INTO SOMEBODY ELSE'S PARSER.

  `received_at` comes back from PostgREST as `2025-11-24T01:11:04` — no zone
  designator — and Graph's OData rejects that outright. Measured on the prime
  on 13 Sep 2026, every backfill tick between 05:44 and 06:50 answered:

    Invalid filter clause: The DateTimeOffset text '2025-11-24T01:11:04'
    should be in format 'yyyy-mm-ddThh:mm:ss('.'s+)?(zzzzzz)?'

  roughly one every five minutes, for sixty-five minutes, while
  `email_copilot_emails` took nothing at all.
*/

describe("graphDateTimeOffset", () => {
  it("gives a bare database timestamp the zone Graph requires", () => {
    // The exact string the prime sent, and the exact one it should have sent.
    expect(graphDateTimeOffset("2025-11-24T01:11:04")).toBe("2025-11-24T01:11:04.000Z");
  });

  it("reads a bare timestamp as UTC rather than as the container's local time", () => {
    /*
      The trap underneath this one. ECMAScript parses a date-ONLY form as UTC
      and a date-TIME form with no offset as LOCAL time — the two disagree, so
      leaving the zone off would make the boundary depend on where the function
      happens to run. These values are stored UTC, so `Z` is appended rather
      than inferred.
    */
    const asUtc = Date.parse("2025-11-24T01:11:04Z");
    expect(Date.parse(graphDateTimeOffset("2025-11-24T01:11:04")!)).toBe(asUtc);
  });

  it("keeps an instant that already carries a zone", () => {
    expect(graphDateTimeOffset("2025-11-24T01:11:04Z")).toBe("2025-11-24T01:11:04.000Z");
    expect(graphDateTimeOffset("2025-11-24T01:11:04.250Z")).toBe("2025-11-24T01:11:04.250Z");
    // An explicit offset is an instant too, and it is not 01:11 UTC.
    expect(graphDateTimeOffset("2025-11-24T01:11:04+11:00")).toBe("2025-11-23T14:11:04.000Z");
    expect(graphDateTimeOffset("2025-11-24T01:11:04+1100")).toBe("2025-11-23T14:11:04.000Z");
  });

  it("accepts the space separator PostgREST can also hand back", () => {
    expect(graphDateTimeOffset("2025-11-24 01:11:04")).toBe("2025-11-24T01:11:04.000Z");
  });

  it("answers null for anything it cannot read, rather than guessing", () => {
    for (const bad of [null, undefined, "", "   ", "not a date", "0000-13-45T99:99:99"]) {
      expect(graphDateTimeOffset(bad)).toBeNull();
    }
  });
});

describe("firstPageUrl", () => {
  const url = (older?: string | null) =>
    firstPageUrl("a@b.test", "inbox", 100, older);

  it("sends the normalised boundary, never the raw column", () => {
    const built = url("2025-11-24T01:11:04");
    expect(built).toContain("$filter=receivedDateTime lt 2025-11-24T01:11:04.000Z");
    expect(built).not.toContain("lt 2025-11-24T01:11:04&");
  });

  it("names the folder's own date field on both sides", () => {
    // `$orderby` and `$filter` must agree, or the walk pages through one
    // ordering while excluding on another.
    const sent = firstPageUrl("a@b.test", "sent", 100, "2025-11-24T01:11:04Z");
    expect(sent).toContain("$orderby=sentDateTime desc");
    expect(sent).toContain("$filter=sentDateTime lt 2025-11-24T01:11:04.000Z");
  });

  it("asks for no filter at all when no boundary was given", () => {
    for (const none of [undefined, null, ""]) {
      expect(url(none)).not.toContain("$filter");
    }
  });

  it("REFUSES a boundary it cannot render rather than dropping it", () => {
    /*
      The important direction. Dropping an unreadable boundary returns the
      NEWEST page instead of the oldest — every row already held, no history
      ever reached, and the walk reporting pages fetched the whole time. That
      is the silent version of the loud bug this fixes, and it is worse.
    */
    expect(() => url("not a date")).toThrow(/cannot read the backfill boundary/);
  });
});
