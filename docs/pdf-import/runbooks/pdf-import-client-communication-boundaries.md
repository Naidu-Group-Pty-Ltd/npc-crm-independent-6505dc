# PDF Import Client Communication Boundaries

## Purpose

Define what may and may not be communicated to clients about PDF import.

## Audience

pdf_admin, business_stakeholder.

## Required Role / Capability

`pdf_admin` or `business_stakeholder`.

## When To Use

Whenever preparing a client-facing update about an import/template.

## Preconditions

You have an internal status you want to translate to a client-safe message.

## Procedure

1. Translate internal status to a client-safe summary.
2. Use approved phrasings (see examples).
3. Remove all internal technical detail.
4. Route anything ambiguous to the business owner.

## Expected Result

A client-safe message with no internal or private data.

## Stop Conditions

You are about to share logs, signed URLs, artifact paths, raw failure traces, or PII — stop.

## Escalation Path

Business owner for wording and client escalations.

## Evidence To Capture

The internal status and the approved client-safe message sent.

## What Not To Do

Never send internal logs, signed URLs, private artifact paths, raw stack traces, or raw extracted text to clients.

## Related Pages / Routes

None (communication only).

## Client-Safe Examples

- "Accepted with minor formatting notes — no action needed."
- "Under QA review — we will confirm shortly."
- "Manual review in progress to ensure fidelity."
- "Export validation pending final checks."

## What Cannot Be Said

No internal logs, no signed URLs, no private artifact paths, no raw failure stack traces, no raw extracted PDF text, no PII.
