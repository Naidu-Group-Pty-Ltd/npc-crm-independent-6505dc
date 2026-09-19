# AML Escalation Matrix

| Trigger | First responder | Escalate within | Then to | Contact channel |
| --- | --- | --- | --- | --- |
| High-risk match (sanctions hit, confirmed PEP) | Analyst | 30 min | MLRO | AML on-call channel + phone |
| Structuring / smurfing pattern in monitoring | Analyst | 1 h | MLRO | AML on-call channel |
| SMR must be lodged | MLRO | Same business day | AUSTRAC portal | AUSTRAC Online (out-of-band) |
| Provider outage (IDV, PEP, screening) | Ops on-call | 15 min | Head of Ops + MLRO | Ops channel |
| Suspected tipping-off breach | Whoever detected | Immediately | MLRO + Legal | Legal hotline |
| Data breach / privacy incident | Ops on-call | 30 min | Privacy Officer + MLRO | Privacy hotline |
| Release-gate FAIL after rollout advance | Anyone | 15 min | MLRO | Governance channel — auto-rollback if unresolved in 1 h |
| AI proposal not decided in 20 h | System notice | On appearance | MLRO | Dashboard notification |
| Retention deletion review overdue | Records officer | Same day | MLRO | Records channel |

## Standing rules

- **Never** discuss an SMR outside the MLRO-approved channel (tipping-off risk).
- Every escalation is logged in the case's audit trail with the actor's name.
- If unsure, escalate. Under-escalation is the higher risk.
