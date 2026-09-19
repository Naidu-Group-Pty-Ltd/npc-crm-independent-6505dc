# PDF Import Permission Denied SOP

## Purpose

Explain what to do when an action is denied or a button is disabled.

## Audience

All roles.

## Required Role / Capability

Any role. Granting access is admin/developer-only.

## When To Use

When a control is disabled or a write returns permission denied.

## Preconditions

You attempted an action your role does not permit.

## Procedure

1. Read the disabled-reason shown on the control.
2. Confirm your role in the operator permission status panel.
3. If you legitimately need the action, request access from a `pdf_admin` / `developer_admin`.
4. Do not attempt to bypass the control.

## Expected Result

You understand why the action is denied and request access through the correct channel.

## Stop Conditions

You are tempted to edit JWT/role data directly; a `permission_escalation_detected` or `unauthorized_write_attempt` alert appears.

## Escalation Path

pdf_admin for role grants; developer_admin/security for suspected escalation.

## Evidence To Capture

The capability required, your current role, and the route.

## What Not To Do

Never bypass permissions, never edit JWT/role data manually unless explicitly approved, never share admin credentials.

## Related Pages / Routes

`/admin/pdf-golden-regression`.

## Related Alerts

`unauthorized_write_attempt`, `permission_escalation_detected`.
