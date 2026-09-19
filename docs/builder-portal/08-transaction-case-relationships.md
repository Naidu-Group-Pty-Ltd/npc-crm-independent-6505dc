# Proposed transaction-case relationship model

**Baseline:** `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`
**Status:** proposed. No schema change is made in Phase 0.

## Current state at baseline

`transaction_case_links` has exactly one row per case (`case_id uuid NOT NULL
UNIQUE`) and three independently unique domain slots:

```sql
case_id          uuid NOT NULL UNIQUE REFERENCES transaction_cases(id)
legal_matter_id  uuid UNIQUE REFERENCES legal_matters(id)
purchase_file_id uuid UNIQUE REFERENCES purchase_files(id)
client_deal_id   uuid UNIQUE REFERENCES client_deals(id)
link_source      text CHECK ('legacy_explicit','legacy_reverse','command_centre','system')
```

`guard_transaction_case_links()` fires `BEFORE INSERT OR UPDATE OF case_id,
legal_matter_id, purchase_file_id, client_deal_id` and raises
`CROSS_CLIENT_CASE_LINK` if any linked record's `client_id` differs from the
case's `client_id`. `transaction_case_link_history` records every link and unlink
with `domain_type CHECK ('legal_matter','purchase_file','client_deal')`.

`transaction_cases.case_type` already permits `'construction'`.

## Target relationship model

```text
transaction_cases
├── client_deals          Command Centre
├── purchase_files        Finance
├── legal_matters         Legal
├── builder_transactions  Builder          <-- new slot
│
├── property_units          reached through builder_transactions
├── property_reservations   reached through property_units
├── construction_cases      reached through builder_transactions
│
├── case_milestones       shared
├── case_tasks            shared
├── conversations         shared
├── document_records      shared
└── audit records         shared
```

The case gains exactly **one** new link slot. `property_units`,
`property_reservations` and `construction_cases` are reached through
`builder_transactions` and are never linked to the case directly — the case is a
shared identity, not a container.

## Proposed schema change (GEN-09)

```sql
ALTER TABLE public.transaction_case_links
  ADD COLUMN IF NOT EXISTS builder_transaction_id uuid UNIQUE
    REFERENCES public.builder_transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transaction_case_links_builder
  ON public.transaction_case_links(builder_transaction_id)
  WHERE builder_transaction_id IS NOT NULL;

ALTER TABLE public.transaction_case_link_history
  DROP CONSTRAINT transaction_case_link_history_domain_type_check,
  ADD CONSTRAINT transaction_case_link_history_domain_type_check
    CHECK (domain_type IN ('legal_matter','purchase_file','client_deal','builder_transaction'));
```

`guard_transaction_case_links()` must be replaced in the **same migration** with
a version that adds the builder branch and extends the trigger's `UPDATE OF`
column list:

```sql
IF NEW.builder_transaction_id IS NOT NULL THEN
  domain_client := NULL;
  SELECT client_id INTO domain_client
    FROM public.builder_transactions WHERE id = NEW.builder_transaction_id;
  IF domain_client IS DISTINCT FROM case_client THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='CROSS_CLIENT_CASE_LINK';
  END IF;
END IF;
```

```sql
DROP TRIGGER IF EXISTS trg_guard_transaction_case_links ON public.transaction_case_links;
CREATE TRIGGER trg_guard_transaction_case_links
  BEFORE INSERT OR UPDATE OF case_id, legal_matter_id, purchase_file_id,
                             client_deal_id, builder_transaction_id
  ON public.transaction_case_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_transaction_case_links();
```

**A column added without both changes is a defect**, not an incomplete feature: a
builder transaction for a different client could be linked, and an `UPDATE` that
only touched `builder_transaction_id` would not fire the trigger at all. This is
migration risk MIG-02.

## Linking invariants (inherited unchanged)

1. Every record linked to a case shares the case's `client_id`, enforced by the
   database trigger.
2. Each `builder_transaction` belongs to at most one case (`UNIQUE`).
3. Each case has at most one builder transaction (one row per case).
4. Link and unlink are atomic, actor-attributed and appended to
   `transaction_case_link_history`.
5. Address similarity never creates a link. `property_address_normalized` on
   `transaction_cases` is descriptive metadata only, as ADR-001 states.
6. Mutable case state carries `row_version`; stale writes return 409.

## Case creation and linking paths

| Origin | Behaviour |
| --- | --- |
| A Builder sale is the first record for a client and property | Create a `transaction_case` with `case_type = 'construction'` (or `'property_purchase'` for established stock) and link the builder transaction with `link_source = 'builder_portal'` |
| A `client_deal` or `purchase_file` already has a case for the same client | Link the builder transaction into the existing case, subject to the free-slot and same-client checks |
| Two candidate cases exist for the same client | Do not guess. Write a `transaction_case_reconciliation_issues` row and leave the builder transaction unlinked |
| The builder transaction has no `client_id` yet (unsold inventory) | No case. A case exists only once there is a client. Unsold units are Builder-domain only |

`link_source` needs a `'builder_portal'` value added to its CHECK list alongside
the GEN-09 change.

## Unsold inventory has no transaction case

This is the most important structural point. `property_units` in `available` or
`temporarily_held` state have **no client and therefore no transaction case**.
Creating cases for unsold inventory would:

- violate `transaction_cases.client_id NOT NULL`
- pollute every case-scoped read model and runway query
- expose unreleased inventory through case-scoped projections

A transaction case comes into existence at `reserved`, when a client is first
attached. Before that, the unit lives entirely inside the Builder domain.

## Effect on read models and runway

- `case_milestones` gains Builder-sourced rows (GEN-03), so `get_case_runway()`
  returns construction milestones alongside legal and finance milestones with no
  change to its shape — only its `_audience` argument needs `'builder'` added.
- A new `builder_case_read_model` (GEN-13) joins the existing
  `client_case_read_model`, `finance_case_read_model`,
  `solicitor_case_read_model` and `command_case_health_read_model`.
- `client_case_read_model` gains approved Builder construction progress through
  the existing outbox and projection path, not through a direct Builder read.
