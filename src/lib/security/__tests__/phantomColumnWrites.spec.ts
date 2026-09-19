import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
const fn = (name: string) => read("supabase", "functions", name, "index.ts");

/*
  A COLUMN THE TABLE DOES NOT HAVE, ON THE WRITE SIDE.

  `aml.cases` taught this repository the read half: PostgREST answers 42703,
  the discarded error leaves `data` null, and a missing column reads exactly
  like a missing row. The WRITE half is worse and was still open on 13 Sep
  2026 — an unknown key in a payload is PGRST204 and fails the whole
  statement, so the row simply never exists.

  Five sites were live, every one of them verified against
  `information_schema.columns` on the prime rather than against the generated
  types, and each is pinned below by the name it must not use again.

  `check-edge-column-names.mjs` could see NONE of them until it was widened in
  the same change: it matched a write body with `[^{}]*`, so a payload carrying
  a template literal was skipped outright, and it skipped a payload bound to a
  `const` altogether. Both shapes are now read. This file is the second guard,
  because a regex-based gate is one refactor away from losing sight of a call
  site while the defect stays.
*/

describe("the CRM outbound message path", () => {
  const sendGhl = fn("send-ghl-message");
  const sendEmail = fn("send-email-reply");
  const code = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  it("never writes `message_type`, which exists in no table, migration or type", () => {
    /*
      This is the one that cost the most. `messageRecord` carried it beside
      `channel_type` with the same value; PostgREST answered PGRST204; the
      error was re-thrown; and the outer catch returned HTTP 500 "CRM messaging
      is temporarily unavailable" — AFTER GoHighLevel had accepted and
      delivered the message. Every outbound SMS and WhatsApp the CRM ever sent
      was really sent, never recorded, and reported to the operator as failed.
    */
    expect(code(sendGhl)).not.toMatch(/message_type\s*:/);
    expect(code(sendEmail)).not.toMatch(/message_type\s*:/);
  });

  it("still writes the columns the table does have", () => {
    // Removing a phantom must never remove a control: the row still carries
    // its channel, its direction and its idempotency key.
    expect(sendGhl).toMatch(/channel_type: channel,/);
    expect(sendGhl).toMatch(/client_request_id: idempotencyKey \|\| null,/);
    expect(sendEmail).toMatch(/channel_type: 'email',/);
  });

  it("reads the error on the writes that used to discard it", () => {
    /*
      Both of these failed silently for months. A write that reports nothing is
      how a feature comes to be dead while every gate stays green — and the
      spec that vouches for the emailed reply is structural and asserts only
      that the code CONTAINS the write.
    */
    expect(sendGhl).toMatch(/const \{ error: failRowError \}/);
    expect(sendEmail).toMatch(/const \{ error: threadPersistError \}/);
  });

  it("never fails the send over the record — the message has already gone", () => {
    // The failure is named, not thrown. Losing the audit row is bad; telling
    // the operator a delivered message failed is worse, and is what happened.
    expect(sendEmail).toMatch(/console\.error\('\[Send Email\] thread persist failed:'/);
    expect(code(sendEmail)).not.toMatch(/throw threadPersistError/);
  });
});

describe("the four other live sites the widened gate found", () => {
  it("the Outlook replay guard writes the column the nonce table has", () => {
    /*
      `internal_request_nonces` has `caller_function`, not `caller`. The insert
      answered PGRST204 rather than the 23505 the branch looks for, so
      `claimNotification` returned true for every notification and the
      idempotency this block exists for was never in force.
    */
    const src = fn("outlook-email-webhook");
    expect(src).toMatch(/caller_function: 'outlook-email-webhook'/);
    expect(src.replace(/\/\/.*$/gm, "")).not.toMatch(/\bcaller:\s*'outlook-email-webhook'/);
  });

  it("a report-engine proposal names which KIND of proposer it is", () => {
    // `proposed_by` does not exist; the table separates `proposed_by_agent`
    // from `proposed_by_user`. The error is thrown, so this endpoint answered
    // 500 on every call it ever received.
    const src = fn("report-engine-inspector");
    expect(src).toMatch(/proposed_by_user: userId/);
    expect(src.replace(/\/\/.*$/gm, "")).not.toMatch(/\bproposed_by:\s/);
  });

  it("the playbook audit row writes, rather than carrying a key that voids it", () => {
    // `agent_action_log` has no `metadata`, and the insert is fire-and-forget,
    // so the playbook audit trail has always been empty.
    const src = fn("ai-dashboard-agent");
    const block = src.slice(src.indexOf("agent_action_log"));
    expect(block.slice(0, 4000)).not.toMatch(/metadata: \{ source: 'playbook'/);
  });

  it("the document reminder is counted only once it has really been written", () => {
    /*
      `client_portal_messages` carries one `message` column and no `subject`,
      `body` or `metadata`, so the automated reminder reached no client while
      `notifiedClient` counted every one of them as sent.
    */
    const src = fn("finance-portal-batch6");
    const block = src.slice(src.indexOf("client_portal_messages"));
    expect(block.slice(0, 1500)).toMatch(/message: `Hi — we're still waiting/);
    expect(block.slice(0, 1500)).not.toMatch(/\bbody:\s/);
    expect(block).toMatch(/if \(reminderError\) \{[\s\S]{0,400}?\} else \{\s*notifiedClient\+\+;/);
  });
});

describe("the gate that could not see any of it", () => {
  const gate = read("scripts", "security", "check-edge-column-names.mjs");

  it("brace-matches a write payload instead of forbidding braces in it", () => {
    // `[^{}]*` skipped every payload carrying a template literal, which is
    // what hid the failed-state row in the CRM send path.
    expect(gate).toMatch(/function objectLiteralAt\(source, open\)/);
    expect(gate).not.toMatch(/insert\|update\|upsert\)\\\(\\s\*\\\{\(\[\^\{\}\]\*\)/);
  });

  it("reads an object literal bound to a const, near the call that sends it", () => {
    expect(gate).toMatch(/function literalForIdentifier\(source, name, callIndex\)/);
    // Scope is approximated, so it must be bounded — a file-wide lookup
    // attributed one function's `const updates = { is_enabled: … }` to four
    // handlers two thousand lines away and reported four columns none of them
    // sends.
    expect(gate).toMatch(/const MAX_DECL_LOOKBACK = \d+;/);
  });

  it("takes top-level keys only, so a nested object is not misread as columns", () => {
    expect(gate).toMatch(/function topLevelKeys\(body\)/);
  });

  it("blanks comments before any structural scan", () => {
    /*
      The scans track quotes so a brace inside a string cannot fool them — and
      a comment is full of unpaired quotes. One apostrophe in prose ("the
      vendor's own cursor") opened a string that never closed, so the payload
      was skipped or mis-parsed, SILENTLY. Comments become spaces rather than
      being removed, so reported line numbers stay exact.
    */
    expect(gate).toMatch(/function blankComments\(source\)/);
    expect(gate).toMatch(/const source = blankComments\(raw\);/);
  });

  it("records a shorthand and a quoted key, and refuses a computed one", () => {
    // `{ user_id }` names the column `user_id` exactly as `{ user_id: 1 }`
    // does; `{ "user_id": 1 }` likewise. A computed key is not a name at all,
    // and is checked FIRST so branches that look like identifiers cannot slip
    // through — that false positive reported `finance_portal_users.morning`.
    expect(gate).toMatch(/const flushShorthand = \(\) => \{/);
    expect(gate).toContain("atKeyPosition && depth === 0 && !sawBracket && token.trim() === ''");
    const colon = gate.slice(gate.indexOf("if (ch === ':' && atKeyPosition)"));
    expect(colon.indexOf("if (sawBracket) return null;"))
      .toBeLessThan(colon.indexOf("/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)"));
  });

  it("refuses a literal that sits on the other side of a function boundary", () => {
    // Proximity cannot tell two adjacent functions apart, and a payload that
    // is a PARAMETER has no binding the scan can see.
    expect(gate).toContain("test(source.slice(braceAt, callIndex))) return null;");
  });
});
