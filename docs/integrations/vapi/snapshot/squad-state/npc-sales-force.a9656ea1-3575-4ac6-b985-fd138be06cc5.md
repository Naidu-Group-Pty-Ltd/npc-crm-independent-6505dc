# NPC Sales Force

`a9656ea1-3575-4ac6-b985-fd138be06cc5` · created 2025-12-09 · updated 2026-05-12 · **NPC**

## Members (4)

### 0. NPC Inbound Agent

- **assistantId**: `bfff143e-03f7-4bc2-afbb-5734987f672f`
- **overrides**: `metadata`, `tools:append`
  - `metadata`: `{"position": {"x": 237.34521448871288, "y": 427.4425751045537}}`
  - **inline tool** `handoff_to_assistant` (type `handoff`, async `False`)
    - says on `request-start`: > Please hold on while I hand you over to the relevant agent to book your call
    - → **NPC Opt In Follow Up Inbound**
      - when: _When user asks to book or reschedule discovery calls_
      - extracts: `firstName`
    - → **NPC Strategy Session Inbound**
      - when: _When user asks to book or reschedule strategy session_
      - extracts: `firstName`
    - → **NPC IFC Inbound**
      - when: _When user asks to book or reschedule an initital finance consult a.k.a IFC_
      - extracts: `firstName`
### 1. NPC Opt In Follow Up Inbound

- **assistantId**: `739b47bf-9adb-4ac6-aca4-976d815f673e`
- **overrides**: `metadata`
  - `metadata`: `{"position": {"x": 711.4278688524591, "y": 92.12315573770486}}`
### 2. NPC Strategy Session Inbound

- **assistantId**: `5ae449c8-1999-4f44-9115-9d63bf7444ae`
- **overrides**: `metadata`
  - `metadata`: `{"position": {"x": 708.8274468453475, "y": 394.48551857441134}}`
### 3. NPC IFC Inbound

- **assistantId**: `7770a48b-68d1-48df-a03a-9cc5b9e91ad8`
- **overrides**: `metadata`
  - `metadata`: `{"position": {"x": 716.587458275248, "y": 712.8696377821774}}`

## Migration notes

- The inline `handoff_to_assistant` tool on member 0 is **not** a managed tool: it exists only in this override. Its destination `assistantId`s must be remapped on clone or the handoff points at the old org and fails silently.
- Routing here has never been exercised: three of the four members have zero calls (see `../call-volume.json`).
