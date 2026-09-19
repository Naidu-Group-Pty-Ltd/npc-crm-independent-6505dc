# `ghl_create_booking` — prose

Everything in this tool that an LLM reads when deciding whether and how to call it, plus everything the tool sends and reads back. Extracted from the committed JSON; nothing added.

`f195a817-8346-475d-ad0e-8033f1d2e283` · type `function`

## Description

Use this tool to create a confirmed GoHighLevel appointment for NPC Services after the caller has selected and clearly confirmed an available time. The tool sends the caller's booking intent, contact ID, location ID, confirmed start time, end time, title, and notes to Make. Make classifies the appointment type and routes the request to the correct hardcoded GoHighLevel calendar. This tool creates a real booking. Only call this tool after contact resolution has returned a valid contactId and after availability has already been checked.

## Parameters (what the model fills in)

### `booking_intent_text` — `string` · **required**

The caller's confirmed appointment type in natural language. Include whether they want a Discovery Call, Strategy Session by Phone, Strategy Session by Zoom, Initial Finance Consult by Phone, or Initial Finance Consult by Zoom.

### `caller_context` — `string`

Relevant booking context, including the confirmed appointment pathway and whether the caller selected phone or Zoom where applicable.

### `contactId` — `string` · **required**

The GoHighLevel contact ID returned by the contact resolver tool. This is required before creating any booking.

### `endTime` — `string` · **required**

The confirmed appointment end time in ISO 8601 format with timezone offset. Example: '2026-05-20T10:30:00+10:00'.

### `locationId` — `string` · **required**

The GoHighLevel location/sub-account ID for NPC Services.

### `notes` — `string`

Internal appointment notes, including caller context, selected slot, and any relevant call details.

### `preferred_date_text` — `string`

The caller's selected appointment time in natural language. Example: '20 May 2026 at 10:00 AM'.

### `search_reason` — `string`

Short internal reason for this booking. Example: 'Caller confirmed discovery call slot after availability check'.

### `startTime` — `string` · **required**

The confirmed appointment start time in ISO 8601 format with timezone offset. Example: '2026-05-20T10:00:00+10:00'.

### `timezone` — `string` · **required**

The appointment timezone. Always use 'Australia/Sydney'.

## Static body fields (sent on every call, the model does not choose these)

_none_

## Variable extraction (what comes back out of the response)

**Schema**: `{"type": "object", "required": [], "properties": {}}`

## Spoken messages

**request-start** (blocking=False)

> Perfect, I’ll go ahead and book that in for you now.

**request-complete** (role=assistant, endCallAfterSpokenEnabled=False)

> All set, your appointment has been booked.

