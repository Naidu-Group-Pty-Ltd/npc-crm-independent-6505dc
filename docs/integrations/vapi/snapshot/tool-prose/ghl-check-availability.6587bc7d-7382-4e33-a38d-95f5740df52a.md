# `ghl_check_availability` — prose

Everything in this tool that an LLM reads when deciding whether and how to call it, plus everything the tool sends and reads back. Extracted from the committed JSON; nothing added.

`6587bc7d-7382-4e33-a38d-95f5740df52a` · type `function`

## Description

Use this tool to check GoHighLevel calendar availability for NPC Services appointment bookings. This tool sends the caller's booking intent to Make, where the appointment type is classified and routed to the correct hardcoded GoHighLevel calendar. Use this tool only to check available appointment slots. Do not use this tool to create a booking. The tool requires the booking intent, a start and end search window in Unix milliseconds, the timezone, and the intended appointment duration.

## Parameters (what the model fills in)

### `booking_intent_text` — `string` · **required**

The caller's requested appointment type in natural language. Include whether they want a Discovery Call, Strategy Session, Initial Finance Consult, and whether the mode is Phone or Zoom if known. Example: 'The caller wants to book a strategy session over the phone.'

### `caller_context` — `string`

Relevant call context that may help classify the correct booking intent. Include whether the caller is a new lead, existing contact, or requested a specific appointment type.

### `duration_minutes` — `number` · **required**

The requested appointment duration in minutes. Use 30 unless the system prompt or booking type specifies a different duration.

### `endDateMs` — `string` · **required**

The end of the availability search window as a Unix timestamp in milliseconds. Must be after startDateMs. Example: '1779260400000'.

### `preferred_date_text` — `string`

The caller's preferred date or time window in natural language, if mentioned. Example: 'next Tuesday morning' or 'any time next week'.

### `search_reason` — `string`

Short internal reason for the availability search. Example: 'Caller requested strategy session phone availability.'

### `startDateMs` — `string` · **required**

The start of the availability search window as a Unix timestamp in milliseconds. Must be a future timestamp. Example: '1778626800000'.

### `timezone` — `string` · **required**

The timezone for the availability search. Always use 'Australia/Sydney' unless the system explicitly instructs otherwise.

## Static body fields (sent on every call, the model does not choose these)

_none_

## Variable extraction (what comes back out of the response)

**Schema**: `{"type": "object", "required": [], "properties": {}}`

## Spoken messages

**request-start** (blocking=False)

> Let me check the available times for you.

