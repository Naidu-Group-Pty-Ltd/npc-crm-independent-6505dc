# Builder cross-portal field-ownership matrix

**Baseline:** `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`
**Status:** proposed. `_shared/crossPortalFieldOwnership.ts` is unchanged in
Phase 0.

Companion to `cross-portal-field-ownership.md`. That document describes the
implemented four-domain matrix; this one describes the five-domain matrix the
Builder programme proposes.

## Current implementation at baseline

`_shared/crossPortalFieldOwnership.ts` declares:

```ts
type PortalDomain = 'command_centre' | 'client' | 'finance' | 'solicitor';
```

and fifteen `FieldOwnershipRule` entries, each with `owning_domain`,
`readable_by`, `writable_by`, `projection_targets` and a `conflict_policy` of
`owner_wins`, `reject` or `derived`. `mayWriteCrossPortalField()` and
`projectionFieldsFor()` read from that table.

There is no `'builder'` domain and no Builder-owned field.

## Proposed type widening (GEN-12)

```ts
type PortalDomain =
  | 'command_centre' | 'client' | 'finance' | 'solicitor' | 'builder';
```

Mechanically trivial. The risk is entirely in the rules below: naming
`'builder'` in `readable_by` for a Finance-private or Legal-private field would
silently open a boundary, and naming a non-Builder domain in `readable_by` for a
Builder-private field would leak commercial data.

## Effect of the widening on existing rules

Adding a member to the union does **not** grant Builder anything. Every existing
rule enumerates its `readable_by` and `projection_targets` explicitly, so
Builder reads nothing until it is named. Two existing rules deserve attention
when Builder is added:

| Existing field | Current | Proposed treatment |
| --- | --- | --- |
| `client_identity` | owned by Command Centre, readable by all four | add `'builder'` to `readable_by` and `projection_targets` — a builder needs the purchaser's name for a linked transaction |
| `shared_lifecycle_status` | owned by `case`, readable by all four, `derived` | add `'builder'` to `readable_by` and `projection_targets` |
| `purchase_price` | owned by Finance, writable by Finance and Command Centre | **do not** grant Builder write. The Builder-owned sale price is a separate field (`unit_sale_price`); the Finance `purchase_price` remains Finance's. Add `'builder'` to `readable_by` only |
| `deposit_amount` | owned by Finance | Builder needs deposit *status*, not the Finance-owned amount. Add a separate `deposit_status` rule rather than widening this one |
| `internal_notes` | Solicitor-only, `reject` | unchanged. Builder is never added |
| `finance_private_notes` | Finance-only, `reject` | unchanged |
| `npc_internal_notes` | Command Centre-only, `reject` | unchanged |

## Proposed Builder-owned rules

| Field | Owner | Readable by | Writable by | Projection targets | Conflict policy |
| --- | --- | --- | --- | --- | --- |
| `property_unit_identity` | builder | command_centre, client, finance, solicitor, builder | builder | client, finance, solicitor, command_centre | owner_wins |
| `unit_release_state` | builder | command_centre, builder | builder | command_centre | owner_wins |
| `unit_list_price` | builder | command_centre, builder | builder | command_centre | owner_wins |
| `unit_sale_price` | builder | command_centre, finance, solicitor, builder | builder | finance, solicitor, command_centre | owner_wins |
| `reservation_status` | builder | command_centre, client, finance, builder | builder | client, finance, command_centre | owner_wins |
| `deposit_status` | builder | command_centre, client, finance, solicitor, builder | builder | client, finance, solicitor, command_centre | owner_wins |
| `contract_issue_status` | builder | command_centre, client, finance, solicitor, builder | builder | client, finance, solicitor, command_centre | owner_wins |
| `contract_execution_status` | builder | command_centre, client, finance, solicitor, builder | builder, solicitor | client, finance, solicitor, command_centre | owner_wins |
| `construction_status` | builder | command_centre, client, finance, solicitor, builder | builder | client, finance, solicitor, command_centre | owner_wins |
| `construction_milestone_state` | builder | command_centre, client, finance, solicitor, builder | builder | client, finance, solicitor, command_centre | owner_wins |
| `estimated_completion_date` | builder | command_centre, client, finance, solicitor, builder | builder | client, finance, solicitor, command_centre | owner_wins |
| `practical_completion_date` | builder | command_centre, client, finance, solicitor, builder | builder | client, finance, solicitor, command_centre | owner_wins |
| `handover_state` | builder | command_centre, client, finance, solicitor, builder | builder | client, finance, solicitor, command_centre | owner_wins |
| `builder_settlement_readiness` | builder | command_centre, finance, solicitor, builder | builder | finance, solicitor, command_centre | owner_wins |
| `approved_variation_summary` | builder | command_centre, client, finance, solicitor, builder | builder | client, finance, solicitor, command_centre | owner_wins |
| `progress_claim_state` | builder | command_centre, finance, builder | builder | finance, command_centre | owner_wins |
| `inspection_state` | builder | command_centre, client, builder | builder | client, command_centre | owner_wins |
| `defect_state` | builder | command_centre, client, builder | builder | client, command_centre | owner_wins |
| `warranty_state` | builder | command_centre, client, builder | builder | client, command_centre | owner_wins |
| `builder_legal_entity` | builder | command_centre, client, finance, solicitor, builder | builder | client, finance, solicitor, command_centre | owner_wins |

## Proposed Builder-private rules (`reject`)

Owned by Builder, readable only by Builder, projected nowhere. `conflict_policy`
is `reject`, matching how `internal_notes`, `finance_private_notes` and
`npc_internal_notes` are treated today.

| Field | Covers |
| --- | --- |
| `builder_private_notes` | internal sales notes, internal management notes, internal dispute commentary |
| `builder_cost_data` | internal construction costs, supplier prices, contractor prices |
| `builder_margin_data` | profit margins, internal feasibility information |
| `builder_private_risk` | private project risks, internal delay reasons |
| `builder_commercial_negotiation` | commercial negotiations, incentives and developer rebates under negotiation |
| `builder_unreleased_inventory` | unreleased inventory and unreleased pricing |
| `builder_staff_performance` | staff performance information |

## Fields Builder must never read

Enumerated so a future rule addition is visibly wrong:

`internal_notes` (Solicitor-private) · `finance_private_notes` ·
`npc_internal_notes` · privileged legal advice · conflict-check results ·
`borrowing_capacity` · serviceability · client income, expenses, assets,
liabilities and employment · AML/CTF records · MLRO notes · SMR records ·
commission ledgers and payouts · lender selection detail.

These are additionally enforced by `BUILDER_FORBIDDEN_KEYS` inside the Builder
`can()` equivalent, so a field-ownership mistake alone cannot expose them.

## Write-conflict rules

1. Builder writes Builder-owned fields. It never writes a Finance-owned or
   Legal-owned field; it proposes, and the owning domain decides.
2. `contract_execution_status` is the one field with two writers (Builder and
   Solicitor) because both observe execution. The `owner_wins` policy resolves to
   Builder; a Solicitor write that disagrees raises a
   `case_milestone_conflicts` row rather than overwriting.
3. `unit_sale_price` (Builder) and `purchase_price` (Finance) are deliberately
   distinct fields. They are reconciled by projection and comparison, never by
   one overwriting the other.
4. A Builder progress *claim* is Builder-owned; the resulting progress *payment*
   is Finance-owned. Builder never writes `build_progress_payments`.

## Verification

`tests/builder-portal/phase0-builder-domain-boundaries.test.mjs` characterises
the current fifteen-rule table and the current four-member `PortalDomain` union,
so any future addition appears explicitly in a diff and is reviewed as a security
change rather than a type change.
