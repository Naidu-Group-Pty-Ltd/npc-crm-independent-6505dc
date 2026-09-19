# PDF Import Operator Quick Start

## Purpose

Give a new operator the fastest safe orientation to the PDF import system: what
it does, what you are allowed to do, and what you must never do.

## Audience

pdf_operator, pdf_qa_operator, pdf_admin.

## Required Role / Capability

`pdf_operator` or above. Read/evaluate needs `pdf_import.view_console` /
`pdf_import.evaluate_only`. Persisting anything needs `pdf_admin`.

## When To Use

On your first day, and whenever you are unsure which workflow or role applies.

## Preconditions

- You have an authenticated account with a PDF import role.
- You know your role (viewer / operator / qa / admin / developer_admin).

## Procedure

1. Learn the vocabulary:
   - **Evaluate Only** — runs analysis, writes nothing, calls no AI, mutates no template.
   - **Evaluate + Persist** — writes metadata/decisions; admin-only; requires confirmation.
   - **Manual-only** — an action a human must perform deliberately; it is never auto-run.
   - **Blocked** — an action that is not permitted; do not attempt to work around it.
2. Know your routes: `/admin/pdf-golden-regression` (operator console),
   `/admin/pdf-import-monitoring`, `/admin/pdf-import-retention`,
   `/admin/template-import-quality`, `/admin/pdf-import-diagnostics`.
3. Start with Evaluate Only (see the Evaluate Only SOP).
4. Escalate anything blocked, failing, or unclear.

## Expected Result

You can run Evaluate Only, read results, and know when to stop and escalate.

## Stop Conditions

- You are asked to persist/accept without the `pdf_admin` role.
- A critical monitoring alert is open.
- Any action is blocked or manual-only and you are tempted to bypass it.

## Escalation Path

Ask a `pdf_admin`; for technical failures escalate to `developer_admin`.

## Evidence To Capture

Import ID, the route used, and a note of what you observed. No screenshots of
client content.

## What Not To Do

Do not call AI, do not persist without the admin role, do not bypass quality
gates, do not share private PDFs or signed URLs.

## Related Pages / Routes

`/admin/pdf-golden-regression`, `/admin/pdf-import-monitoring`.

## First-Day Checklist

- [ ] Read this quick start + Evaluate Only SOP + Permission Denied SOP.
- [ ] Confirm your role with a pdf_admin.
- [ ] Run one Evaluate Only on a test import.
- [ ] Read the Client Communication Boundaries runbook.
