import { beforeEach, describe, expect, it, vi } from "vitest";

const ghlFetchShared = vi.fn();

vi.mock("../../../../supabase/functions/_shared/ghl-rate-limiter.ts", () => ({
  ghlFetchShared: (...args: unknown[]) => ghlFetchShared(...args),
  tokenKeyFor: () => "ghl:test:key",
}));

import {
  GHL_CONVERSATION_PAGE_LIMIT,
  GHL_MESSAGE_PAGE_LIMIT,
  MAX_PAGES_PER_CONVERSATION,
  fetchMessagesOlderThan,
  fetchMessagesUntilHeld,
  searchConversationsForContact,
} from "../../../../supabase/functions/_shared/ghlConversationPaging";

/*
  THE FOUR FACTS, AND WHY THEY ARE FOUR.

  `ghlFetchShared` RETURNS a non-2xx response after its retries rather than
  throwing. So the natural shape — `if (!res.ok) break` — leaves the loop with
  no cursor, having spent no budget and hit no cap, and every "did we finish?"
  test then answers yes. A refused walk and a completed one become the same
  answer, which is how an import comes to report success over a thread it never
  read.

  Every test below drives the real module with a scripted vendor.
*/

const supabase = {} as never;
const headers = { Authorization: "Bearer x" };
const base = "https://services.leadconnectorhq.com";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const bad = (status: number) => new Response("nope", { status });

/** Every URL the module asked for, in order. */
const urls = () => ghlFetchShared.mock.calls.map((c) => String(c[2]));

const conv = (id: string, lastMessageDate = "2026-09-01T00:00:00.000Z") => ({
  id, type: "TYPE_SMS", lastMessageDate,
});
const msg = (id: string) => ({ id, direction: "inbound", dateAdded: "2026-09-01T00:00:00.000Z" });

/** A page GHL filled to the limit, so the walk has reason to ask for another. */
const fullPage = (tailId: string) =>
  Array.from({ length: GHL_CONVERSATION_PAGE_LIMIT }, (_, i) =>
    conv(i === GHL_CONVERSATION_PAGE_LIMIT - 1 ? tailId : `c${i}`, "2026-08-02T03:04:05.000Z"));

beforeEach(() => ghlFetchShared.mockReset());

describe("searchConversationsForContact", () => {
  const run = (opts: Record<string, unknown> = {}) =>
    searchConversationsForContact(supabase, "k", headers, {
      base, locationId: "loc", contactId: "c1", ...opts,
    });

  it("pages until the vendor offers no further cursor", async () => {
    ghlFetchShared
      .mockResolvedValueOnce(ok({ conversations: [conv("a"), conv("b")], meta: { startAfterId: "b", startAfter: 1756684800000 } }))
      .mockResolvedValueOnce(ok({ conversations: [conv("c")], meta: {} }));

    // Page two is short and carries no cursor, so the walk ends there rather
    // than buying a third request to be told the same thing.
    const w = await run();
    expect(w.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(w.exhausted).toBe(true);
    expect(w.failed).toBe(false);
    expect(w.requests).toBe(2);
  });

  it("sends the cursor GHL's search actually takes, and asks for a full page", async () => {
    ghlFetchShared
      .mockResolvedValueOnce(ok({ conversations: [conv("a")], meta: { startAfterId: "a", startAfter: 1756684800000 } }))
      .mockResolvedValueOnce(ok({ conversations: [] }));

    await run();
    expect(urls()[0]).toContain(`limit=${GHL_CONVERSATION_PAGE_LIMIT}`);
    expect(urls()[0]).not.toContain("startAfter");
    expect(urls()[1]).toContain("startAfterId=a");
    expect(urls()[1]).toContain("startAfter=1756684800000");
  });

  it("never reads `nextPage` on the search endpoint", async () => {
    /*
      That field exists only on the messages sub-endpoint, and reading it here
      is what made a previous worker exit after one page. A page that offers a
      cursor is followed whatever `nextPage` says.
    */
    ghlFetchShared
      .mockResolvedValueOnce(ok({ conversations: [conv("a")], nextPage: false, meta: { startAfterId: "a", startAfter: 1 } }))
      .mockResolvedValueOnce(ok({ conversations: [conv("b")], nextPage: false, meta: {} }))
      .mockResolvedValueOnce(ok({ conversations: [] }));

    const w = await run();
    expect(w.items).toHaveLength(2);
  });

  it("does not synthesise a cursor off a short page the vendor did not paginate", async () => {
    /*
      Measured on the prime: 0 of 753 contacts hold more than one conversation,
      so synthesising a cursor unconditionally makes every contact cost a
      second request that comes back empty — double the largest band's spend,
      to learn nothing.
    */
    ghlFetchShared.mockResolvedValueOnce(ok({ conversations: [conv("a")] }));
    const w = await run();
    expect(w.requests).toBe(1);
    expect(w.exhausted).toBe(true);
    expect(w.items.map((i) => i.id)).toEqual(["a"]);
  });

  it("still follows an EXPLICIT cursor off a short page", async () => {
    // The saving must never cost a page. A vendor cursor wins whatever the
    // page length — this is not the `length < limit` rule the message walk
    // forbids.
    ghlFetchShared
      .mockResolvedValueOnce(ok({ conversations: [conv("a")], meta: { startAfterId: "a", startAfter: 1756684800000 } }))
      .mockResolvedValueOnce(ok({ conversations: [conv("b")] }));
    const w = await run();
    expect(w.requests).toBe(2);
    expect(w.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(w.exhausted).toBe(true);
  });

  it("falls back to the page tail when the vendor sends no meta on a FULL page", async () => {
    // A full page with no cursor is very likely not the end, so the tail is
    // synthesised rather than the walk being abandoned.
    ghlFetchShared
      .mockResolvedValueOnce(ok({ conversations: fullPage("z") }))
      .mockResolvedValueOnce(ok({ conversations: [] }));

    await run();
    expect(urls()[1]).toContain("startAfterId=z");
    expect(urls()[1]).toContain(`startAfter=${Date.parse("2026-08-02T03:04:05.000Z")}`);
  });

  it("reports a refusal as a refusal, never as exhaustion", async () => {
    ghlFetchShared.mockResolvedValueOnce(bad(429));
    const w = await run();
    expect(w.failed).toBe(true);
    expect(w.failureStatus).toBe(429);
    expect(w.exhausted).toBe(false);
    expect(w.stoppedOnBudget).toBe(false);
    expect(w.hitPageCap).toBe(false);
  });

  it("keeps the pages it already read when a later one is refused", async () => {
    ghlFetchShared
      .mockResolvedValueOnce(ok({ conversations: [conv("a")], meta: { startAfterId: "a", startAfter: 1 } }))
      .mockResolvedValueOnce(bad(500));
    const w = await run();
    expect(w.items.map((i) => i.id)).toEqual(["a"]);
    expect(w.failed).toBe(true);
    expect(w.exhausted).toBe(false);
  });

  it("reports a budget stop as a budget stop, never as exhaustion", async () => {
    let calls = 0;
    ghlFetchShared.mockImplementation(() => {
      calls++;
      return Promise.resolve(ok({ conversations: [conv(`c${calls}`)], meta: { startAfterId: `c${calls}`, startAfter: calls } }));
    });
    const w = await searchConversationsForContact(supabase, "k", headers, {
      base, locationId: "loc", contactId: "c1", stop: () => calls >= 2,
    });
    expect(w.stoppedOnBudget).toBe(true);
    expect(w.exhausted).toBe(false);
    expect(w.items).toHaveLength(2);
  });

  it("makes one request even when the budget is already spent", async () => {
    // A pass whose clock ran out between bands should still make progress
    // rather than report nothing and re-queue the same contact.
    ghlFetchShared.mockResolvedValueOnce(ok({ conversations: [conv("a")], meta: {} }));
    const w = await searchConversationsForContact(supabase, "k", headers, {
      base, locationId: "loc", contactId: "c1", stop: () => true,
    });
    expect(w.requests).toBe(1);
    expect(w.items).toHaveLength(1);
  });

  it("reports the page cap as the page cap, never as exhaustion", async () => {
    let n = 0;
    ghlFetchShared.mockImplementation(() => {
      n++;
      return Promise.resolve(ok({ conversations: [conv(`c${n}`)], meta: { startAfterId: `c${n}`, startAfter: n } }));
    });
    const w = await searchConversationsForContact(supabase, "k", headers, {
      base, locationId: "loc", contactId: "c1", maxPages: 3,
    });
    expect(w.hitPageCap).toBe(true);
    expect(w.exhausted).toBe(false);
    expect(w.pages).toBe(3);
  });

  it("stops rather than dropping a boundary it cannot render", async () => {
    /*
      `startAfter` has to reach GHL as milliseconds. Sending the next request
      without it returns page one, for ever — so an unrenderable boundary with
      no id beside it ends the walk instead, and does not report exhaustion.
    */
    // A FULL page, so the walk genuinely wants to continue and the boundary
    // is the only thing stopping it. On a short page the vendor has simply
    // not paginated, and the walk is exhausted for an ordinary reason.
    ghlFetchShared.mockResolvedValueOnce(
      ok({
        conversations: Array.from({ length: GHL_CONVERSATION_PAGE_LIMIT }, () => ({
          type: "TYPE_SMS", lastMessageDate: "not a date",
        })),
      }),
    );
    const w = await run();
    expect(w.requests).toBe(1);
    expect(w.exhausted).toBe(false);
    expect(w.failed).toBe(false);
  });
});

describe("fetchMessagesUntilHeld", () => {
  const run = (heldIds: Set<string>, opts: Record<string, unknown> = {}) =>
    fetchMessagesUntilHeld(supabase, "k", headers, {
      base, conversationId: "conv1", heldIds, ...opts,
    });

  it("stops on the first page it already holds in full", async () => {
    const page = [msg("m1"), msg("m2")];
    ghlFetchShared.mockResolvedValueOnce(ok({ messages: { messages: page, lastMessageId: "m2" } }));
    const w = await run(new Set(["m1", "m2"]));
    expect(w.requests).toBe(1);
    expect(w.exhausted).toBe(true);
  });

  it("crosses a page that holds even one message it has not seen", async () => {
    /*
      The stop condition is asked of the WHOLE page, which is what fills a gap
      rather than fencing the walk off above it — and then the FIRST fully-held
      page below the gap ends the walk, because everything under it is already
      in the table.
    */
    ghlFetchShared
      .mockResolvedValueOnce(ok({ messages: { messages: [msg("m1"), msg("new")], lastMessageId: "new" } }))
      .mockResolvedValueOnce(ok({ messages: { messages: [msg("m2")], lastMessageId: "m2" } }));
    const w = await run(new Set(["m1", "m2"]));
    expect(w.requests).toBe(2);
    expect(w.items.map((m) => m.id)).toEqual(["m1", "new", "m2"]);
    expect(w.exhausted).toBe(true);
  });

  it("does not treat a short page as the end of the thread", async () => {
    /*
      The copy this replaces ended the walk on `messages.length < 50`. Only the
      absence of a cursor ends a walk.
    */
    ghlFetchShared
      .mockResolvedValueOnce(ok({ messages: { messages: [msg("a")], lastMessageId: "a" } }))
      .mockResolvedValueOnce(ok({ messages: { messages: [msg("b")], lastMessageId: "b" } }))
      .mockResolvedValueOnce(ok({ messages: { messages: [] } }));
    const w = await run(new Set());
    expect(w.items).toHaveLength(2);
    expect(w.exhausted).toBe(true);
  });

  it("reads a flat array envelope and still finds a cursor", async () => {
    ghlFetchShared
      .mockResolvedValueOnce(ok({ messages: [msg("a"), msg("b")] }))
      .mockResolvedValueOnce(ok({ messages: [] }));
    const w = await run(new Set());
    expect(w.items).toHaveLength(2);
    expect(urls()[1]).toContain("lastMessageId=b");
  });

  it("ends rather than spinning when the cursor stops moving", async () => {
    // A fresh Response each call: a body may only be read once, and reusing
    // one would fail the walk for a reason the vendor never gave.
    ghlFetchShared.mockImplementation(() =>
      Promise.resolve(ok({ messages: { messages: [msg("a")], lastMessageId: "a" } })));
    const w = await run(new Set());
    // Page one sets the cursor to `a`; page two is offered the same cursor and
    // the walk ends instead of asking for ever.
    expect(w.requests).toBeLessThanOrEqual(2);
    expect(w.exhausted).toBe(true);
  });

  it("asks for a full message page and no cursor on the first request", async () => {
    ghlFetchShared.mockResolvedValueOnce(ok({ messages: { messages: [] } }));
    await run(new Set());
    expect(urls()[0]).toContain(`limit=${GHL_MESSAGE_PAGE_LIMIT}`);
    expect(urls()[0]).not.toContain("lastMessageId");
    expect(urls()[0]).toContain("/conversations/conv1/messages");
  });

  it("caps one thread so a pathological one cannot eat the tick", async () => {
    let n = 0;
    ghlFetchShared.mockImplementation(() => {
      n++;
      return Promise.resolve(ok({ messages: { messages: [msg(`m${n}`)], lastMessageId: `m${n}` } }));
    });
    const w = await run(new Set());
    expect(w.pages).toBe(MAX_PAGES_PER_CONVERSATION);
    expect(w.hitPageCap).toBe(true);
    expect(w.exhausted).toBe(false);
  });
});

describe("fetchMessagesOlderThan", () => {
  it("seeds the walk at the anchor, which is what reaches history", async () => {
    ghlFetchShared
      .mockResolvedValueOnce(ok({ messages: { messages: [msg("older")], lastMessageId: "older" } }))
      .mockResolvedValueOnce(ok({ messages: { messages: [] } }));
    const w = await fetchMessagesOlderThan(supabase, "k", headers, {
      base, conversationId: "conv1", anchorMessageId: "oldestHeld",
    });
    expect(urls()[0]).toContain("lastMessageId=oldestHeld");
    expect(w.items.map((m) => m.id)).toEqual(["older"]);
  });

  it("costs one request when GHL declines the anchor and returns page one", async () => {
    /*
      An anchor it no longer holds — or one minted locally for a message it
      rejected — is answered with the NEWEST messages, which we already hold in
      full. Without the held set that is a walk back down the whole thread on
      every tick.
    */
    ghlFetchShared.mockImplementation(() =>
      Promise.resolve(ok({ messages: { messages: [msg("m1"), msg("m2")], lastMessageId: "m2" } })));
    const w = await fetchMessagesOlderThan(supabase, "k", headers, {
      base, conversationId: "conv1", anchorMessageId: "gone", heldIds: new Set(["m1", "m2"]),
    });
    expect(w.requests).toBe(1);
  });
});
