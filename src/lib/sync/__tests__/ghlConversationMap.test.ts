import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONVERSATION_ROW_KEYS,
  GHL_NON_MESSAGE_CHANNELS,
  MESSAGE_ROW_KEYS,
  classifyGhlEntry,
  isCorrespondence,
  summariseWithheldEntries,
  withheldEntriesSentence,
  mapChannelType,
  mapContentType,
  mapMessageDirection,
  parseGhlDate,
  toConversationRow,
  toMessageRow,
} from "../../../../supabase/functions/_shared/ghlConversationMap.pure";

/*
  ONE SHAPE FOR A CONVERSATION AND A MESSAGE.

  These mappers existed in four copies. Two call sites writing the same message
  through two copies of `mapMessageDirection` is how one message comes to be
  `inbound` on the scheduled path and `outbound` on the browser's refresh, with
  `onConflict: 'ghl_message_id'` making whichever ran last the winner.

  The column sets below are pinned against the LIVE tables rather than against
  the migrations, because a migration in this repository
  (`20260723150000_conversation_message_delivery_safety.sql`) adds three
  columns and has never been applied to any database in the fleet — so "named
  by a migration" is not evidence a column exists. `check-edge-column-names.mjs`
  judges the generated types UNION the migrations and therefore cannot see
  this; a row assembled in a mapper module is invisible to it in any case.
*/

/** Read from `information_schema.columns` on the prime, 13 Sep 2026. */
const LIVE_CONVERSATION_COLUMNS = new Set([
  "id", "client_id", "ghl_conversation_id", "ghl_contact_id", "channel_type",
  "last_message_body", "last_message_date", "last_message_direction",
  "unread_count", "conversation_status", "assigned_to", "last_synced_at",
  "created_at", "updated_at", "new_ghl_conversation_id", "replayed_at",
]);

const LIVE_MESSAGE_COLUMNS = new Set([
  "id", "conversation_id", "ghl_message_id", "direction", "channel_type",
  "body", "content_type", "attachment_urls", "sender_name", "sender_number",
  "recipient_number", "message_status", "ghl_date_added", "created_at",
  "updated_at", "new_ghl_message_id", "replayed_at", "replay_skipped_reason",
]);

/** The migration worker's replay bookkeeping. An import must not touch it. */
const REPLAY_COLUMNS = [
  "new_ghl_conversation_id", "new_ghl_message_id", "replayed_at", "replay_skipped_reason",
];

describe("the column sets are the ones the tables actually have", () => {
  it("writes no conversation column the live table lacks", () => {
    for (const key of CONVERSATION_ROW_KEYS) expect(LIVE_CONVERSATION_COLUMNS).toContain(key);
  });

  it("writes no message column the live table lacks", () => {
    for (const key of MESSAGE_ROW_KEYS) expect(LIVE_MESSAGE_COLUMNS).toContain(key);
  });

  it("the declared key sets are exactly what the mappers produce", () => {
    // Otherwise the lists above vouch for something nothing writes.
    expect(Object.keys(toConversationRow({ id: "c" }, {
      clientId: null, ghlContactId: "g", syncedAtIso: "2026-09-13T00:00:00.000Z",
    })).sort()).toEqual([...CONVERSATION_ROW_KEYS].sort());
    expect(Object.keys(toMessageRow({ id: "m" }, "local")).sort())
      .toEqual([...MESSAGE_ROW_KEYS].sort());
  });

  it("never writes a replay column", () => {
    for (const col of REPLAY_COLUMNS) {
      expect(CONVERSATION_ROW_KEYS).not.toContain(col);
      expect(MESSAGE_ROW_KEYS).not.toContain(col);
    }
  });

  it("never writes a column that exists only in the unapplied migration", () => {
    /*
      `available_channels`, `client_request_id` and `error_message` are added by
      a committed migration that is absent from `schema_migrations` on every
      project. `message_type` is named by two send paths and by no migration at
      all. All four answer PGRST204 on a write.
    */
    for (const phantom of ["available_channels", "client_request_id", "error_message", "message_type"]) {
      expect(CONVERSATION_ROW_KEYS).not.toContain(phantom);
      expect(MESSAGE_ROW_KEYS).not.toContain(phantom);
    }
  });
});

describe("parseGhlDate", () => {
  it("reads a string of digits, which `new Date` gets wrong", () => {
    // `new Date("1731022800000")` is Invalid Date, not a timestamp.
    expect(new Date("1731022800000").getTime()).toBeNaN();
    expect(parseGhlDate("1731022800000")).toBe(new Date(1731022800000).toISOString());
  });

  it("separates seconds from milliseconds by magnitude", () => {
    expect(parseGhlDate(1731022800)).toBe(new Date(1731022800000).toISOString());
    expect(parseGhlDate(1731022800000)).toBe(new Date(1731022800000).toISOString());
  });

  it("reads an ISO string", () => {
    expect(parseGhlDate("2026-09-13T01:02:03Z")).toBe("2026-09-13T01:02:03.000Z");
  });

  it("answers null for an absence rather than an epoch", () => {
    for (const v of [null, undefined, "", "not a date", NaN]) expect(parseGhlDate(v)).toBeNull();
  });
});

describe("mapMessageDirection", () => {
  it("lets an explicit direction outrank everything else", () => {
    expect(mapMessageDirection({ direction: "inbound", incoming: false, userId: "u" })).toBe("inbound");
    expect(mapMessageDirection({ direction: 2, incoming: true })).toBe("outbound");
    expect(mapMessageDirection({ direction: "1" })).toBe("inbound");
  });

  it("falls back to `incoming`, then to a staff user id", () => {
    expect(mapMessageDirection({ incoming: true, userId: "u" })).toBe("inbound");
    expect(mapMessageDirection({ incoming: false })).toBe("outbound");
    expect(mapMessageDirection({ userId: "u" })).toBe("outbound");
    expect(mapMessageDirection({})).toBe("outbound");
  });
});

describe("the mapper and the migration are one vocabulary", () => {
  it("normalises every alias the reissue migration normalises", () => {
    /*
      The migration rewrites eight aliases to sms/email/whatsapp. The mapper
      knew four of them, and because an unrecognised value passes THROUGH, the
      very next sync wrote `type_sms` and `mail` straight back over the rows
      the migration had just cleaned — undoing a repair, tick after tick,
      while `available_channels` and the inbox filter key on the clean values.

      The migration is PARSED rather than the list restated, so the two cannot
      drift apart in the direction that matters.
    */
    const migration = readFileSync(
      join(__dirname, "..", "..", "..", "..", "supabase", "migrations",
        "20260913094500_conversation_delivery_safety_reissue.sql"),
      "utf8",
    );
    const pairs = [...migration.matchAll(/WHEN '([a-z_]+)' THEN '([a-z]+)'/g)];
    expect(pairs.length).toBeGreaterThanOrEqual(8);
    for (const [, alias, canonical] of pairs) {
      expect(mapChannelType(alias)).toBe(canonical);
      // And upper-cased, which is how GHL actually sends several of them.
      expect(mapChannelType(alias.toUpperCase())).toBe(canonical);
    }
  });
});

describe("mapChannelType", () => {
  it("normalises GHL's several spellings of one channel", () => {
    for (const v of ["sms", "1", "phone", "TYPE_PHONE"]) expect(mapChannelType(v)).toBe("sms");
    for (const v of ["email", "2", "TYPE_EMAIL"]) expect(mapChannelType(v)).toBe("email");
    expect(mapChannelType("FB")).toBe("facebook");
  });

  it("passes an unrecognised channel through rather than calling it a text", () => {
    // A new GHL channel should arrive in the column as itself and be visible,
    // not be silently recorded as a text message.
    expect(mapChannelType("type_something_new")).toBe("type_something_new");
    expect(mapChannelType(undefined)).toBe("sms");
  });
});

describe("mapContentType", () => {
  it("only ever answers a value the column accepts", () => {
    expect(mapContentType("image/png")).toBe("image");
    expect(mapContentType("application/pdf")).toBe("text");
    expect(mapContentType(undefined)).toBe("text");
  });
});

describe("the direction precedence the other copy got wrong", () => {
  it("reads `lastMessageDirection` as itself", () => {
    /*
      `sync-ghl-conversations` wrote
        conv.lastMessageDirection || conv.lastMessageType === 1 ? 'inbound' : 'outbound'
      and `||` binds looser than `===`, so the condition is
      `(direction || (type === 1))` — the string 'outbound' is truthy and
      selected 'inbound'. Every thread that path touched recorded its last
      message as incoming.
    */
    const row = toConversationRow(
      { id: "c", lastMessageDirection: "outbound", lastMessageType: 2 },
      { clientId: null, ghlContactId: "g", syncedAtIso: "2026-09-13T00:00:00.000Z" },
    );
    expect(row.last_message_direction).toBe("outbound");
  });

  it("and the source of that bug is gone from the repository", () => {
    const root = join(__dirname, "..", "..", "..", "..");
    for (const fn of ["sync-ghl-conversations", "conversation-sync-cron"]) {
      const src = readFileSync(join(root, "supabase", "functions", fn, "index.ts"), "utf8");
      expect(src).not.toMatch(/lastMessageDirection \|\| conv\.lastMessageType === 1 \?/);
    }
  });
});

describe("toMessageRow", () => {
  it("keeps attachments only when there are some", () => {
    expect(toMessageRow({ id: "m", attachments: [{ url: "a" }, {}, { url: "b" }] }, "c").attachment_urls)
      .toEqual(["a", "b"]);
    expect(toMessageRow({ id: "m", attachments: [] }, "c").attachment_urls).toBeNull();
    expect(toMessageRow({ id: "m" }, "c").attachment_urls).toBeNull();
  });

  it("binds the row to the LOCAL conversation id, never GHL's", () => {
    expect(toMessageRow({ id: "m", conversationId: "ghl-side" }, "local-uuid").conversation_id)
      .toBe("local-uuid");
  });
});

/*
  AN ENTRY IS NOT ALWAYS A MESSAGE.

  `/conversations/{id}/messages` returns a thread's ENTRIES. GHL interleaves
  its own activity records among them under the same field that carries the
  channel, so one value has to answer both "how was this sent" and "was
  anything sent at all". It cannot, which is why the kind is asked separately.

  Measured on the prime 13 Sep 2026, after the deep backfill: 4,753 of 13,255
  rows (36%) were non-message entries, reaching 1,150 of 1,272 conversations,
  and 465 threads held NOTHING else.
*/
describe("classifyGhlEntry", () => {
  it("calls every activity kind production actually wrote an activity", () => {
    for (const channel of ["type_activity_opportunity", "type_activity_appointment", "type_activity_contact"]) {
      expect(classifyGhlEntry(channel)).toBe("activity");
    }
  });

  it("recognises an activity kind this deployment has never seen", () => {
    // GHL publishes TYPE_ACTIVITY_INVOICE and TYPE_ACTIVITY_PAYMENT. An
    // enumeration is a list of what we happened to meet; the prefix is the
    // rule, so an invoice does not arrive as an untyped bubble.
    expect(classifyGhlEntry("type_activity_invoice")).toBe("activity");
    expect(classifyGhlEntry("type_activity_payment")).toBe("activity");
  });

  it("separates a call from a message, though both are real events", () => {
    expect(classifyGhlEntry("type_call")).toBe("call");
    expect(isCorrespondence("type_call")).toBe(false);
  });

  it("leaves every real channel alone", () => {
    for (const channel of ["sms", "email", "whatsapp", "facebook", "instagram", "live_chat", "type_sms", "type_email"]) {
      expect(classifyGhlEntry(channel)).toBe("message");
      expect(isCorrespondence(channel)).toBe(true);
    }
  });

  it("treats an unknown channel as a message, because refusing to draw is the greater harm", () => {
    // Pass-through is `mapChannelType`'s rule and it holds here: a channel
    // nobody has seen before must reach a reader as itself. Only the two
    // families GHL documents as non-messages are withheld.
    expect(classifyGhlEntry("type_some_new_channel")).toBe("message");
    expect(isCorrespondence("")).toBe(true);
    expect(isCorrespondence(null)).toBe(true);
    expect(isCorrespondence(undefined)).toBe(true);
  });

  it("is case- and whitespace-insensitive, because the column is not normalised on read", () => {
    expect(classifyGhlEntry("  TYPE_ACTIVITY_OPPORTUNITY  ")).toBe("activity");
    expect(classifyGhlEntry("TYPE_CALL")).toBe("call");
  });

  it("withholds exactly the kinds it names and nothing else", () => {
    for (const channel of GHL_NON_MESSAGE_CHANNELS) {
      expect(isCorrespondence(channel)).toBe(false);
    }
  });

  it("withholds the row the WRITER produces for a GHL activity entry", () => {
    // This is the seam that matters, and the first version of this test missed
    // it entirely: it looped our own OUTPUT vocabulary back into
    // `mapChannelType` ("sms" -> "sms" -> isCorrespondence true), which is a
    // tautology and a duplicate of the test above.
    //
    // Production never calls the classifier with a raw GHL string. The UI calls
    // `isCorrespondence(msg.channel_type)`, and `channel_type` is whatever
    // `toMessageRow` WROTE. So the property to pin is end-to-end: a GHL
    // activity entry must become a row the thread withholds.
    //
    // Two mutations at this seam were measured to survive the whole suite
    // before this test existed, and each one puts all 4,753 activity rows back
    // on screen: mapping an activity kind onto a friendly word in
    // `mapChannelType`'s table, and swapping the `messageType ?? source`
    // precedence in `toMessageRow`. Both fail here now.
    for (const kind of GHL_NON_MESSAGE_CHANNELS) {
      const row = toMessageRow({ id: "m1", messageType: kind, source: "app" }, "conv-1");
      expect(isCorrespondence(row.channel_type)).toBe(false);
    }
  });

  it("withholds an activity kind this deployment has never seen, end to end", () => {
    const row = toMessageRow({ id: "m2", messageType: "TYPE_ACTIVITY_INVOICE" }, "conv-1");
    expect(isCorrespondence(row.channel_type)).toBe(false);
  });

  it("still writes a real message as correspondence", () => {
    // The other half of the same property: the filter must not eat real traffic.
    for (const kind of ["type_sms", "SMS", "type_email", "type_whatsapp", "1", "2"]) {
      const row = toMessageRow({ id: "m3", messageType: kind }, "conv-1");
      expect(isCorrespondence(row.channel_type)).toBe(true);
    }
  });
});

/*
  WHAT A THREAD SAYS IT IS WITHHOLDING.

  The first version of the notice named "opportunity, appointment and call
  records" on every thread whatever it held — the hard-coded enumeration this
  module's own header forbids. A thread holding only `type_activity_contact`
  was told about three categories it has none of, and the one it does hold went
  unnamed.
*/
describe("summariseWithheldEntries / withheldEntriesSentence", () => {
  it("counts only what is withheld, and names what is actually there", () => {
    const s = summariseWithheldEntries([
      "sms", "type_activity_opportunity", "email", "type_activity_opportunity", "type_call",
    ]);
    expect(s.count).toBe(3);
    expect(s.kinds).toEqual(["opportunity", "call"]);
  });

  it("names a kind it has never seen, from the value itself", () => {
    expect(summariseWithheldEntries(["type_activity_invoice"]).kinds).toEqual(["invoice"]);
    expect(summariseWithheldEntries(["type_activity_purchase_order"]).kinds)
      .toEqual(["purchase order"]);
  });

  it("says nothing at all when nothing is withheld", () => {
    expect(withheldEntriesSentence(summariseWithheldEntries(["sms", "email"]))).toBe("");
    expect(withheldEntriesSentence({ count: 0, kinds: [] })).toBe("");
  });

  it("is scoped to the conversation, never to the customer", () => {
    // The count is per-thread; the first wording said "recorded against this
    // contact", which describes a different and larger set.
    const sentence = withheldEntriesSentence(summariseWithheldEntries(["type_activity_contact"]));
    expect(sentence).toContain("on this conversation");
    expect(sentence).not.toContain("this contact");
  });

  it("agrees in number", () => {
    expect(withheldEntriesSentence(summariseWithheldEntries(["type_call"])))
      .toMatch(/^1 CRM activity entry is /);
    expect(withheldEntriesSentence(summariseWithheldEntries(["type_call", "type_call"])))
      .toMatch(/^2 CRM activity entries are /);
  });

  it("drops the naming clause rather than inventing a word for it", () => {
    // `classifyGhlEntry` withholds by prefix; if a value ever yields no usable
    // word, a count with no list is honest and a list with a guess is not.
    const sentence = withheldEntriesSentence({ count: 2, kinds: [] });
    expect(sentence).toContain("2 CRM activity entries are recorded on this conversation");
    expect(sentence).not.toContain("—");
  });

  it("never names a category the thread does not hold", () => {
    const sentence = withheldEntriesSentence(
      summariseWithheldEntries(["type_activity_opportunity", "type_activity_opportunity"]),
    );
    expect(sentence).toContain("opportunity");
    expect(sentence).not.toContain("appointment");
    expect(sentence).not.toContain("call");
  });
});
