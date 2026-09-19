# get_call_context

`0bd36de8-6d3a-43e5-9c3f-25ca6de97662` · type `function` · async `False` · version `v1`
· created 2026-05-14 · updated 2026-05-14 10:17:52
· org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd`

## Server

- **URL**: `https://hook.eu2.make.com/o51u3jb5g1nn1lxiluziezpr7gh5vvt8`
- **timeoutSeconds**: `20`
- **staticIpAddressesEnabled**: `—`
- **headers**: none
- **credential**: no authentication

## Function

- **name**: `get_call_context`
- **strict**: `—`
- **model-supplied parameters** (0): —
- **required**: —
- **description**: 363 chars → [prose](../tool-prose/get-call-context.0bd36de8-6d3a-43e5-9c3f-25ca6de97662.md)

## Static body fields

| Key | Value |
| --- | --- |
| `vapiCallId` | `{{ call.id }}` |
| `callerPhone` | `{{ customer.number }}` |
| `phone` | `{{ customer.number }}` |

## Variable extraction

| Variable | From response |
| --- | --- |
| `contextFound` | `{{ $.contextFound }}` |
| `contactId` | `{{ $.contactId }}` |
| `firstName` | `{{ $.firstName }}` |
| `fullName` | `{{ $.fullName }}` |
| `phone` | `{{ $.phone }}` |
| `callerPhone` | `{{ $.callerPhone }}` |
| `contactState` | `{{ $.contactState }}` |
| `contactFound` | `{{ $.contactFound }}` |
| `contactCreated` | `{{ $.contactCreated }}` |
| `confirmedIntent` | `{{ $.confirmedIntent }}` |
| `callerReason` | `{{ $.callerReason }}` |
| `handoffReady` | `{{ $.handoffReady }}` |
| `vapiCallId` | `{{ $.vapiCallId }}` |

## Messages

- `request-start`: (empty)

## Used by 1 assistant(s)

- NPC Inbound Agent
