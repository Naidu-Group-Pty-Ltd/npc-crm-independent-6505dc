# Distributing one Passport to several partners

**Read this before touching `passportRecipients.pure.ts`, `PassportRecipientsPanel`,
the `deliver_to` argument on `grantAccess`, or the wizard's grant step.**

A Compliance Passport exists so that one completed CDD process can be relied on
by every partner in a matter — the financier, the builder, the conveyancer —
without any of them re-approaching the client. Distributing it to several
partners is not an advanced case; it is the product. It had no surface, and the
one send path it did have was silent about the only thing that matters.

## What was reported, and what was actually true

> "I am trying to allocate the same client's Passport through to alternative
> partners that are existing and new ones, however the existing portals do not
> seem to be receiving the links, notifications or any communication through."

Every instinct here is wrong, and the register proves it. `aml.reliance_grants`
held **two** grants for the same case and organisation, both correct, both
active, both with a live token hash. Multiple distribution already persisted
perfectly. The newest grant's `delivered_to_email` was **null**.

`grant_access` emails the Passport link when — and only when — it is handed a
`deliver_to`. The onboarding wizard called it as:

```ts
const res = await amlRelianceApi.grantAccess(caseId, agreement.id);
```

No argument, no email, no error. The grant was minted, the audit event was
written, the partner-access notification fired from the table trigger, the
workspace drew a green badge — and nothing was ever sent to the partner. The
operator was handed a raw bearer token and told to "deliver it to the partner
through their usual channel", which is not a channel.

Three facts compounded it:

| Fact | Consequence |
| --- | --- |
| `aml.partner_portal_memberships` is empty | no partner is inside a portal on this deployment |
| every `aml_partner_workspace_*` flag is `false` | there is no in-portal Passport surface to appear in |
| the token is stored as a SHA-256 hash only | the link shown once was the only copy in existence |

So the operator was waiting for something to appear in a portal that has no
such screen, for a partner who was never emailed, holding a credential that
could not be recovered.

## The rules

**Delivery is part of the act, not an option on it.** The workspace's send path
requires an address and refuses to mint against anything that is not one. A
grant nobody was emailed is access with no channel, and it is indistinguishable
from a healthy grant in every register — which is exactly how this survived.
`passportRecipients` gives it a state of its own, `undelivered`, and the panel
leads with it.

**Holding a Passport and having been SENT one are different facts.** They can
disagree, and the reading carries both. Nothing counts a partner as holding a
Passport because a row exists.

**A live link can never be re-read, so sending again is a REPLACEMENT.** Only
the hash is stored. A holder's send passes `reissue_of`, which supersedes the
link they have; the workspace says so before the click rather than in a toast
afterwards. Offering to "resend the same link" would promise a copy nothing —
including this platform — can produce.

**A row is an arrangement, never a person.** `grant_access` takes an agreement
id and refuses without an active one, so the unit of distribution is the
written arrangement under Pt 2 Div 7. A partner with no arrangement is not a
row here; they are an onboarding.

## Why there is exactly one send path

There were two, and that is why one of them was wrong.

`issuePassportTo` handed the minted link to `PassportIssuedDialog`, which holds
it as a read-only field VALUE. `reissueGrant` passed it as a prompt field's
`placeholder`. Placeholder text is not a value: it cannot be selected, cannot
be copied, is not submitted, and is not in the DOM as a value. So the box a
reader saw as "the link", at the one moment the credential existed, was empty —
the defect that was reported, fixed on the first path, and survived untouched
on the second.

`sendPassport` is now the only path. A re-issue is that same act with
`reissue_of` set, which is also why it cannot become a weaker act than a first
grant: every precondition is re-run by construction.

The same reasoning added `PromptField.value`. A dialog that "pre-fills" an
address by placeholder alone makes an operator retype something the platform
already holds; the send box opens with the address the link last went to, or
the address that accepted the agreement, and null rather than a guess when
neither exists. It never borrows another organisation's address.

## The access token

The raw bearer token and the `/passport/<token>` link are the same credential.
The link is what a person opens; the token exists for a partner system reading
the Passport over the API without a browser.

Presenting the token as the deliverable asked an everyday operator to answer a
question they do not have — *what is this, and do I need it?* — at the exact
moment they were trying to finish. It is now behind a disclosure labelled for
what it is. It is still shown once, because it still cannot be read again.

## What the panel is allowed to say

`passportRecipients` derives no obligation, no readiness and no compliance
verdict. Every state is arithmetic over rows the case already holds, and every
send is re-decided by `grant_access`, which re-checks the arrangement, its
review date, the client's `compliance_sharing` consent and the attestation and
refuses in its own words.

The headline is a count. A test asserts it can never spell *clear*,
*compliant*, *verified* or *satisfied* — a distribution list is not a statement
about the customer.

And the panel says plainly where a Passport actually appears. With every
`aml_partner_workspace_*` flag off, the emailed link is the only channel a
partner has, and an operator who believes otherwise waits for a portal screen
that does not exist on this deployment.

## Tests that carry it

- `src/lib/aml/passport/passportRecipients.test.ts` — the reading: undelivered
  is not live, a holder's act supersedes, blockers are per-row, the suggested
  address is never borrowed, the headline is never a verdict.
- `src/components/aml/__tests__/passportRecipients.test.tsx` — **rendered**.
  Clicking the act reaches `grantAccess` with a `deliver_to`; a holder's click
  carries `reissue_of`; the address box opens holding a value; the one-time
  link is a real value in the DOM.
- `src/components/aml/__tests__/partnerOnboardingDelivery.test.tsx` —
  **rendered**. The wizard passes `deliver_to`. No source-scanning test could
  see its absence, because the call was present and spelled correctly.

## Withdrawing access — and why there is no delete

`revoke_grant` existed from the first version of this feature and **no surface
ever called it**. A Passport could be given and never taken back, on the one
screen whose entire subject is who may read a client's completed due
diligence. It is now the row's own menu item.

**Withdrawal is not deletion, and the difference is the point.** A grant is
the record that a disclosure was authorised. Deleting it destroys that record;
revoking it stops the access and keeps the history — which is the only version
of "remove this partner" a compliance register may offer. The panel says so
once, where the act is, rather than leaving an operator to wonder why there is
no bin icon.

Three rules:

- **A reason is required** (ten characters, enforced by the server). A
  revocation nobody can explain later is a fact nobody can act on.
- **Only a LIVE grant can be withdrawn.** A lapsed one has already stopped
  working and a withdrawn one is already withdrawn, so the menu item is absent
  rather than present-and-inert.
- **It is not gated by what gates issuing.** An overdue arrangement review, a
  missing attestation and the `aml_partner_grants_write` flag all stop *new*
  disclosure. Stopping disclosure is what this does, so none of them may
  prevent it — the MLRO role is the only condition.

## The card had become the wall it was built to prevent

The explained action list existed because bare header buttons refused every
click with a toast that read as a broken button. It worked — and then five
rows of three lines each, all permanently open, became the thing an operator
had to read past to reach the work. Alongside it the same grants were listed
twice (once as recipients, once as "Link history") and the acceptance banner
re-announced a live Passport that the row directly beneath it already showed.

Every word is still there and no reasoning changed. What changed is when it is
on screen:

- **One act is open** — the one the server's own reading marks `ready` — and
  the rest are one line each behind a disclosure.
- **The statutory notice is a disclosure**, because it is a standing
  explanation rather than news.
- **"Link history" is gone**, because its live rows are the recipients list
  and its lapsed and withdrawn rows are that list's collapsed *Ended access*
  group. One register, rendered once.
- **The acceptance banner no longer renders its `issued` state.** TypeScript
  proves that branch is dead rather than leaving it to rot.

A partner row is now one line: name, standing, and the single act on offer.
Everything secondary — withdraw, copy the last address — is in the row's own
menu, because a destructive act should be deliberate and a rare one should not
compete with the common one.
