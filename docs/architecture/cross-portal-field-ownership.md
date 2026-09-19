# Cross-portal field ownership registry

The executable source of truth is `supabase/functions/_shared/crossPortalFieldOwnership.ts`. Generic mutation allowlists must call that registry; projection workers must use explicit audience columns rather than copying source rows or JSON payloads.

| Field | Owner | Projection audiences | Conflict policy |
|---|---|---|---|
| Client identity | Command Centre | Client, Finance, Solicitor | Owner wins |
| Shared lifecycle | Transaction case | All portals | Derived |
| Purchase price, deposit, finance clause | Finance | Sanitised legal coordination only | Finance wins |
| Finance status, lender | Finance | Audience-specific summaries | Finance wins |
| Finance contact | Finance | Command Centre and Solicitor coordination | Finance wins |
| Legal status, contractual settlement date | Solicitor | Command Centre, Client, Finance | Solicitor wins |
| Shared summary | Solicitor | Command Centre, Client | Solicitor wins |
| Legal practice contact | Solicitor | Command Centre, Client and Finance coordination | Solicitor wins |
| Practice internal notes | Solicitor | Solicitor only | Reject cross-domain writes |
| NPC internal notes | Command Centre | Command Centre only | Reject cross-domain writes |
| Finance private notes | Finance | Finance only | Reject cross-domain writes |

A portal may submit a proposal to the owning domain in later workflows; it must not directly overwrite another domain's authoritative field. Restricted client financial-position and AML/SMR data are outside the case registry and remain hard-denied.
