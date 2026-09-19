# Patent v2 — Flow Diagrams (Figs 1–16)

Companion to `AU_PATENT_SPECIFICATION_DRAFT_v2.md` §14. All diagrams are
Mermaid. Render via GitHub, VS Code Mermaid preview, or
`mmdc -i <file> -o <fig>.svg`. Each diagram below maps 1:1 to a numbered
figure in the specification.

---

## Fig 1 — System Topology

```mermaid
flowchart TB
  subgraph Clients["User surfaces"]
    C1["Client browser<br/>(/client/*)"]
    C2["Finance partner<br/>(/finance/*)"]
    C3["Internal staff<br/>(/admin/*, /*)"]
  end

  subgraph SPA["React 18 + Vite SPA (TypeScript, Tailwind v3)"]
    SPA1["Per-portal session token<br/>(header + body dual-path)"]
  end

  subgraph Edge["Deno Edge Functions (Supabase)"]
    E1["verifyAuth + role check"]
    E2["invokeSecureFunction mediator<br/>ALLOWED_TABLES whitelist"]
  end

  subgraph DB["Postgres (Supabase)"]
    D1["service_role-only RLS"]
    D2["Realtime publication"]
    D3["pg_cron schedulers"]
  end

  subgraph Ext["External services"]
    X1["GHL CRM<br/>(dual account)"]
    X2["VAPI + Twilio + TwiML"]
    X3["ElevenLabs<br/>voice profile"]
    X4["OpenAI LLM"]
    X5["Make.com + Outlook<br/>+ Airtable"]
  end

  C1 --> SPA1
  C2 --> SPA1
  C3 --> SPA1
  SPA1 --> E1 --> E2 --> D1
  D1 --- D2
  D1 --- D3
  E2 --> X1
  E2 --> X2
  X2 --> X3
  X2 --> X4
  E2 --> X5
```

---

## Fig 2 — Client Portal Include-Mask Data Flow

```mermaid
sequenceDiagram
  participant UI as Client portal view
  participant H as usePortalAuth
  participant EF as Edge fn (client-portal-loader)
  participant DB as Postgres (service_role)

  UI->>H: request view payload (categories[])
  H->>EF: POST { sessionToken, include: ["profile","portfolio","reports"] }
  EF->>EF: resolve portal_user_id from token
  EF->>EF: validate include[] against ALLOWED_CATEGORIES
  EF->>DB: scoped SELECTs per category (service_role)
  DB-->>EF: rows
  EF->>EF: shape response = { profile?, portfolio?, reports? }
  EF-->>H: include-shaped JSON (no overfetch)
  H-->>UI: render only requested categories
```

---

## Fig 3 — Purchase File Aggregate + Hash-Chained Audit

```mermaid
flowchart LR
  PF[(purchase_files)]
  PF --> SH[purchase_file_status_history<br/>18-state machine]
  PF --> CD[critical_dates<br/>date_type]
  PF --> ST[settlement_tasks<br/>auto-seeded on unconditional_approval]
  PF --> DR[document_requirement_instances]
  PF --> LP[lender_packets + gap-check]
  PF --> DC[decisions<br/>subject_to_lmi_approval]
  PF --> CO[conditions]
  PF --> VA[valuations]
  PF -.bidirectional FK.-> CDEAL[(client_deals)]
  PF --> AF[activity_feed<br/>tri-portal visibility flags]

  subgraph Audit["purchase_file_audit_events (hash chain)"]
    A1[event N-1<br/>row_hash = H<sub>n-1</sub>]
    A2[event N<br/>prev_hash = H<sub>n-1</sub><br/>row_hash = SHA256(prev_hash‖payload)]
    A3[event N+1<br/>prev_hash = H<sub>n</sub>]
    A1 --> A2 --> A3
  end

  PF --> Audit
```

---

## Fig 4 — Calculator Prefill ↔ Push-Back

```mermaid
flowchart LR
  subgraph Records["Typed property records"]
    R1[(commercial_capex)]
    R2[(commercial_financing)]
    R3[(industrial_financing)]
  end

  subgraph Adapter["Normalisation adapter"]
    A1[prefill mapper]
    A2[push-back persister]
  end

  subgraph Engine["Calculator engine inputs/outputs"]
    E1[Borrowing / NOI / CapRate /<br/>ICR / DSCR / Debt Yield /<br/>GST / DCF / 10-yr CF]
  end

  Records -->|prefill| A1 --> E1
  E1 -->|selected outputs<br/>(NOI, assessment rate,<br/>funds-to-complete)| A2 --> Records

  Mode["sourceMode per tab:<br/>global · manualOverride ·<br/>aiPending · savedPropertyLinked · scenario"]
  Mode -.governs.-> A1
  Mode -.gates.-> A2
```

---

## Fig 5 — Borrowing Capacity Engine I/O

```mermaid
flowchart LR
  subgraph In[Inputs]
    I1[dealProfile<br/>assetCategory, state, leaseStatus]
    I2[purchaserStructure<br/>type, cash equity, liquidity]
    I3[propertyValuation<br/>price, market value, confidence]
    I4[leaseIncome<br/>passing/market rent, vacancy, recoveries]
    I5[operatingExpenses]
    I6[lendingAssumptions<br/>rate, buffer, floor, LVR, ICR, DSCR, Debt Yield]
    I7[acquisitionCosts<br/>stamp duty, fees, GST treatment]
  end

  ENG((Borrowing Capacity<br/>engine))

  subgraph Out[Outputs]
    O1[borrowingOutputs<br/>max loan, constraints]
    O2[fundsToComplete<br/>required equity]
    O3[ICR/DSCR/DebtYield<br/>compliance]
    O4[creditAssessmentStatus<br/>purchaseAbilityStatus]
    O5[warnings + required documents]
  end

  In --> ENG --> Out
```

---

## Fig 6 — Aurixa Agent Component Diagram

```mermaid
flowchart TB
  Chat[Chat surface<br/>command centre]
  Reg[Tool Registry<br/>~150 tools<br/>name · params · validation ·<br/>read-only/mutating · rollback flag]
  Classifier[Intent + risk classifier]
  Preview[Preview generator<br/>(mutating only)]
  Approval{User approval}
  Exec[Executor<br/>service-role calls]
  Log[Audit log<br/>+ rollback data store]
  Undo[Undo verifier<br/>ownership · state ·<br/>permission · target row]

  Chat --> Classifier --> Reg --> Preview --> Approval
  Approval -- approved --> Exec --> Log
  Approval -- cancelled --> Log
  Classifier -- read-only --> Exec
  Log --> Undo
  Undo -. rollback .-> Exec
```

---

## Fig 7 — Aurixa State Machine

```mermaid
stateDiagram-v2
  [*] --> ReceiveInstruction
  ReceiveInstruction --> LoadContext
  LoadContext --> ClassifyIntent
  ClassifyIntent --> SelectTools
  SelectTools --> DraftArgs
  DraftArgs --> ClassifyRisk
  ClassifyRisk --> ReadOnlyExec: read-only
  ClassifyRisk --> GeneratePreview: mutating
  GeneratePreview --> AwaitApproval
  AwaitApproval --> Execute: approved
  AwaitApproval --> LogCancel: cancelled
  Execute --> StoreRollback
  StoreRollback --> LogAction
  ReadOnlyExec --> LogAction
  LogAction --> UpdateConversation
  LogCancel --> UpdateConversation
  UpdateConversation --> ExposeUndo
  ExposeUndo --> [*]
```

---

## Fig 8 — Outbound Voice Flow

```mermaid
sequenceDiagram
  participant CRM as GHL CRM
  participant MK as Make.com orchestrator
  participant TW as Twilio
  participant TB as TwiML Bin
  participant VP as VAPI runtime
  participant LLM as OpenAI
  participant ADP as CRM/Calendar adapter

  CRM->>MK: event (lead created / stage change / tag / appointment)
  MK->>MK: validate payload + select outbound agent
  MK->>MK: build normalised context (contact, pipeline, campaign, appt)
  MK->>TW: place call (to, from, context)
  TW->>TB: fetch instructions
  TB->>VP: connect call to runtime
  VP->>LLM: dialogue turns (system prompt + tools)
  LLM-->>VP: tool call(s)
  VP->>ADP: search_contact / create_booking / add_tag / write_call_summary
  ADP->>CRM: provider-specific API
  VP-->>MK: writeback (status, duration, transcript,<br/>summary, qualification, booking,<br/>objections, next task, escalation)
  MK->>CRM: persist outcomes
```

---

## Fig 9 — Inbound Front-Desk → Sub-Agent Routing

```mermaid
flowchart TB
  Call[Inbound call] --> FD[Front-desk agent]
  FD --> Lookup[CRM phone-number lookup]
  Lookup -- hit --> Ctx[Build normalised context]
  Lookup -- miss --> Create[create_contact] --> Ctx
  Ctx --> Route{Intent classifier}
  Route --> Book[Booking sub-agent]
  Route --> Qual[Qualification sub-agent]
  Route --> Sup[Support sub-agent]
  Route --> Res[Reschedule sub-agent]
  Route --> Rem[Reminder sub-agent]
  Route --> Bill[Billing sub-agent]
  Route --> Esc[Escalation sub-agent]
  Book & Qual & Sup & Res & Rem & Bill & Esc --> WB[Writeback to CRM<br/>+ session log]
```

---

## Fig 10 — CRM Adapter Abstraction

```mermaid
flowchart LR
  subgraph Agents["Voice + Aurixa agents"]
    T1[search_contact]
    T2[create_contact]
    T3[create_booking]
    T4[add_tag]
    T5[write_call_summary]
  end

  STD[Standard tool surface<br/>(provider-agnostic schema)]
  T1 & T2 & T3 & T4 & T5 --> STD

  STD --> R[_shared/ghl-account.ts<br/>dual-account resolver]
  R -- legacy --> G1[GHL legacy account]
  R -- new --> G2[GHL new account]
  STD -. future .-> CRM2[Other CRM adapter]
```

---

## Fig 11 — Normalised Voice Context Object

```mermaid
classDiagram
  class VoiceContext {
    +string sessionId
    +string agentId
    +string callDirection  // inbound | outbound
    +Contact contact
    +Pipeline pipeline
    +Campaign campaign
    +Appointment appointment
    +Permissions permittedTools
    +Locale locale
  }
  class Contact {
    +uuid crmId
    +string name
    +string phone
    +string email
    +string[] tags
    +string lifecycleStage
  }
  class Pipeline {
    +string pipelineId
    +string stageId
    +string ownerId
  }
  class Campaign {
    +string campaignId
    +string triggerEvent
    +string objective
  }
  class Appointment {
    +uuid id
    +datetime startsAt
    +string modality // phone|zoom|meet|teams|in-person
    +string status
  }
  VoiceContext --> Contact
  VoiceContext --> Pipeline
  VoiceContext --> Campaign
  VoiceContext --> Appointment
```

---

## Fig 12 — Property Intake Pipeline

```mermaid
flowchart TB
  M[Outlook monitor<br/>(unread trigger)] --> S[Source intake<br/>master-table row]
  S --> H[HTML → text]
  H --> SEG[Segmenter<br/>~6k chars / 500 overlap]
  S --> AC[Attachment classifier]
  SEG --> R{Router}
  AC --> R
  R -- body/text --> TX[Text branch]
  R -- pdf/docx --> DOC[Document branch<br/>download → store → extract]
  R -- png/jpg --> IMG[Image branch<br/>visual extraction]
  R -- url --> LNK[Hyperlink classifier] --> WS[Webpage scraper]
  TX & DOC & IMG & WS --> EX[Schema-constrained<br/>LLM extractor]
  EX --> N[Normaliser<br/>state · postcode · sector · price]
  N --> GEO[Geocoder<br/>(Google Maps)]
  GEO --> DUP[Duplicate detector]
  DUP --> ING[(Airtable master table)]
  ING --> CR[Confidence + review]
  ING --> ERR[Error handler<br/>typed states]
  ING --> LC[Lifecycle tracker<br/>first/last seen, change_type]
```

---

## Fig 13 — LLM JSON Output Contract

```mermaid
classDiagram
  class ExtractorOutput {
    +Metadata metadata
    +Listing[] listings
  }
  class Metadata {
    +string record_type
    +string source_type   // email_body|pdf|docx|image|webpage
    +string processing_status
    +string extraction_method
    +string ai_model
    +string prompt_version
    +int extracted_listings_count
    +bool parsed_json_valid
  }
  class Listing {
    +Identity identity
    +Address address
    +Geocode geocode
    +Classification classification
    +Terms terms
    +Specs specs
    +Agent agent
    +Inspection inspection
    +Links links
    +Confidence confidence
    +Review review
    +Error error
    +Lifecycle lifecycle
  }
  ExtractorOutput --> Metadata
  ExtractorOutput --> Listing
```

---

## Fig 14 — Single Master Table Sections

```mermaid
flowchart LR
  ROW[(Master listing row)]
  ROW --- C1[Record classification]
  ROW --- C2[Source email]
  ROW --- C3[Source attachment/document]
  ROW --- C4[Property identity & dedupe]
  ROW --- C5[Address & location]
  ROW --- C6[Property classification]
  ROW --- C7[Sale / rent / commercial terms]
  ROW --- C8[Specifications]
  ROW --- C9[Agent / agency]
  ROW --- C10[Inspection]
  ROW --- C11[Links / media / enrichment]
  ROW --- C12[AI audit]
  ROW --- C13[Confidence / review]
  ROW --- C14[Error]
  ROW --- C15[Lifecycle]
  ROW --- C16[Notes]
```

---

## Fig 15 — Duplicate Detection Key Derivation

```mermaid
flowchart TB
  IN[Incoming normalised listing] --> K1[Key A: property_unique_id]
  IN --> K2[Key B: street_no + street + suburb + state + postcode]
  IN --> K3[Key C: project + estate + stage<br/>(land/H&L)]
  K1 & K2 & K3 --> M{Match against<br/>existing rows}
  M -- A hit --> S1[Confirmed Duplicate]
  M -- B hit, A miss --> S2[Possible Duplicate]
  M -- C hit, A+B miss --> S3[Possible Duplicate<br/>(project-level)]
  M -- B hit + diff price/status --> S4[Updated Existing]
  M -- no hit --> S5[New]
  M -- ambiguous --> S6[Needs Review]
  M -- excluded by rule --> S7[Not Duplicate]
  M -- unresolved --> S8[Unknown]
```

---

## Fig 16 — Confidence / Review / Error State Diagram

```mermaid
stateDiagram-v2
  [*] --> Ingested
  Ingested --> ConfidenceScored
  ConfidenceScored --> AutoAccepted: all fields ≥ threshold
  ConfidenceScored --> NeedsReview: any field < threshold<br/>OR structured review reason
  NeedsReview --> Reviewed: human edits
  Reviewed --> AutoAccepted
  Ingested --> Errored: typed error
  Errored --> Errored: retry<br/>(model/timeout/geocode/airtable)
  Errored --> NeedsReview: manual escalation
  AutoAccepted --> Published
  Published --> Lifecycle: first_seen set
  Lifecycle --> Lifecycle: price/status change → change_type
  Published --> [*]
```

---

### Rendering tip

```bash
npx -y @mermaid-js/mermaid-cli \
  -i docs/patent/AU_PATENT_SPECIFICATION_DRAFT_v2_DIAGRAMS.md \
  -o docs/patent/figs/fig.svg
```
