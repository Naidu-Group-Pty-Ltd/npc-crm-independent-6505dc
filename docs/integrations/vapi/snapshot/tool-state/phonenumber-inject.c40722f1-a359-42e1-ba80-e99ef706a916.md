# phoneNumber_inject

`c40722f1-a359-42e1-ba80-e99ef706a916` · type `function` · async `False` · version `v1`
· created 2026-05-14 · updated 2026-05-14 06:38:31
· org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd`

## Server

- **URL**: `https://hook.eu2.make.com/ryb05h6kzpzv8fnwi6lki6r8lldokomy`
- **timeoutSeconds**: `20`
- **staticIpAddressesEnabled**: `—`
- **headers**: none
- **credential**: no authentication

## Function

- **name**: `phoneNumber_inject`
- **strict**: `—`
- **model-supplied parameters** (2): `callerReason`, `confirmedIntent`
- **required**: `confirmedIntent`
- **description**: 320 chars → [prose](../tool-prose/phonenumber-inject.c40722f1-a359-42e1-ba80-e99ef706a916.md)

## Static body fields

| Key | Value |
| --- | --- |
| `contactId` | `{{ contactId }}` |
| `firstName` | `{{ firstName }}` |
| `fullName` | `{{ fullName }}` |
| `phone` | `{{ phone }}` |
| `contactState` | `{{ contactState }}` |
| `callerPhone` | `{{ customer.number }}` |
| `vapiCallId` | `{{ call.id }}` |
| `callType` | `{{ call.type }}` |
| `ghlContactId` | `{{ ghlContactId }}` |
| `ghlFirstName` | `{{ ghlFirstName }}` |
| `ghlFullName` | `{{ ghlFullName }}` |
| `ghlContactPhone` | `{{ ghlContactPhone }}` |
| `ghlContactState` | `{{ ghlContactState }}` |

## Variable extraction

| Variable | From response |
| --- | --- |
| `contactId` | `{{ $.contactId }}` |
| `firstName` | `{{ $.firstName }}` |
| `fullName` | `{{ $.fullName }}` |
| `phone` | `{{ $.phone }}` |
| `contactState` | `{{ $.contactState }}` |
| `confirmedIntent` | `{{ $.confirmedIntent }}` |
| `callerReason` | `{{ $.callerReason }}` |
| `handoffReady` | `{{ $.handoffReady }}` |
| `vapiCallId` | `{{ $.vapiCallId }}` |

## Messages

- `request-start`: (empty)

## Used by 0 assistant(s)

_no assistant references this tool_
