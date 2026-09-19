# Stage 5 — regulatory validation

Checked against current Australian Government primary sources on **19 August
2026**, before changing anything Stage 5 asserts about obligations. This
records what was verified and what it means for the code; it is a summary with
references, not a reproduction of the sources.

## Sources checked

| Source | Used for |
| --- | --- |
| [AUSTRAC — Politically exposed persons (PEP)](https://www.austrac.gov.au/industry-and-business/obligations-and-guidance/your-amlctf-program/customer-due-diligence/politically-exposed-persons-pep) | who is a PEP; what a reporting entity must establish |
| [AUSTRAC — Politically exposed persons (Reform)](https://www.austrac.gov.au/amlctf-reform/reforms-guidance/amlctf-program-reform/customer-due-diligence-reform/politically-exposed-persons-reform) | the reformed CDD position |
| [AUSTRAC — Enhanced customer due diligence](https://www.austrac.gov.au/industry-and-business/obligations-and-guidance/your-amlctf-program/customer-due-diligence/enhanced-customer-due-diligence) | consequences of a PEP finding; source of funds / source of wealth |
| [AUSTRAC — Persons designated for targeted financial sanctions (TFS)](https://www.austrac.gov.au/industry-and-business/obligations-and-guidance/your-amlctf-program/customer-due-diligence/persons-designated-targeted-financial-sanctions-tfs) | the TFS limb of initial CDD |
| [AUSTRAC — AML/CTF transitional rules 2026](https://www.austrac.gov.au/about-us/legislation/updates-legislation/amlctf-transitional-rules-2026) | which CDD regime currently applies |
| [DFAT — Consolidated List](https://www.dfat.gov.au/international-relations/security/sanctions/consolidated-list) and [Guide to Australia's Consolidated List](https://www.dfat.gov.au/international-relations/security/sanctions/consolidated-list/guide-australias-consolidated-list) | the authoritative Australian sanctions source |
| [DFAT — Sanctions compliance for real estate professionals](https://www.dfat.gov.au/international-relations/security/sanctions/guidance-note/sanctions-compliance-real-estate-professionals) | who the TFS prohibition binds |

## What was confirmed, and what the code does about it

**A PEP is not only the office-holder.** AUSTRAC's definition covers people
entrusted with prominent public functions *and* people connected to them —
domestic, foreign and international-organisation PEPs. The determination is
made by the reporting entity; a customer's own answer is evidence towards it.

→ The code already treats a client declaration as evidence and never as the
determination (`pep_determinations` is written only by the authorised
operation). **Unchanged.** The Client Portal question currently asks the
individual about themselves only, which is narrower than the definition — see
*Deferred* below.

**Targeted financial sanctions bind every dealing.** The prohibition on making
assets available to, or dealing with assets of, a designated person is a
criminal offence and is not risk-based: it does not soften for a low-risk
customer.

→ This is exactly the existing rule in `screeningPolicy.pure.ts`: no risk,
rating or questionnaire input can stand sanctions down, and a test asserts no
perimeter reason code can even be *spelled* in terms of risk. The only lever
is whether the case is a dealing at all. **Unchanged, and confirmed correct.**

**The Consolidated List is the authoritative Australian source**, maintained
by the Australian Sanctions Office and updated regularly (the current list was
relaunched 6 November 2025).

→ The product screens against `aml.sanctions_entries`, loaded from that list,
and refuses to screen against an empty or stale one. This work adds a Stage 5
card that names the source and reports its live state, so an operator can see
which source a determination rests on. **Additive.**

**A PEP finding triggers enhanced CDD**, including establishing source of funds
and source of wealth on reasonable grounds.

→ Those controls already exist and are untouched. Stage 5 records the
*determination*; it does not shortcut what follows from a positive one.

**Transitional rules are in force in 2026.** Entities enrolled on 30 March 2026
may continue under ACIP for a limited period instead of the new initial CDD
obligations.

→ No code change: the product's obligations are already at or above the
reformed position, and nothing here relaxes toward the transitional floor.

## The standing rule

Where Aurixa policy is **stricter** than the regulatory minimum it stays
stricter. Nothing in this work relaxes an obligation; every change either
reports an existing obligation more clearly, or makes a reading *fail closed*
where it previously did not.

## Deferred, with reasons

**The Client Portal PEP question** asks the individual about themselves. The
definition reaches immediate family members and close associates, so a broader
question with progressive disclosure would collect better evidence.

Not changed here because the questionnaire is versioned and answered
submissions are compliance evidence: widening the question is a questionnaire
*version* change with a migration and a legacy-readability plan, not a copy
edit. Doing it inside a UX PR would silently change what historical answers
mean. It is the right next piece of work and belongs in its own change.

The same applies to the "adverse media or sanctions concerns" question: asking
a customer whether they are sanctioned invites them to answer a question the
reporting entity must answer itself. The existing sanctions *declaration*
section — which collects identity and aliases and states plainly that Aurixa
performs the screening — is the correct architecture and is untouched.
