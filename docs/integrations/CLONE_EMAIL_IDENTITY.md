# A clone's email is sent as the clone

Every Resend email this repository sends, except password recovery, is
addressed through one module:
[`_shared/emailIdentity.pure.ts`](../../supabase/functions/_shared/emailIdentity.pure.ts)
(the rules) and [`_shared/emailIdentity.ts`](../../supabase/functions/_shared/emailIdentity.ts)
(what it reads). Read this before adding a Resend send site, changing a
`from:`, building a link into an email, or touching `brand-config.ts`.

Mission Control's half, which gives each clone its own sending domain and key,
is `docs/CLONE_EMAIL_IDENTITY.md` in `aurixa-mission-control`.

---

## What was wrong

Measured 24 Sep 2026. Every clone's mail introduced it as somebody else, in
four different ways, and each one was invisible from the clone that sent it.

| Deployment | Resend identity | Settings tables | What its mail said |
| --- | --- | --- | --- |
| Prime (`dduzbchuswwbefdunfct`) | its own verified domain | filled in | correct |
| NPC Client Dashboard (`plisdzywzleljorrphxv`) | `send.npc.aurixasystems.com.au`, verified | filled in; contact address overwritten with the sending mailbox | right name; finance and solicitor invites opened the prime; portal notifications and step-up codes refused |
| Preflight Property Group (`egrmsulhtmqnmhvuccxr`) | `send.preflight-property-group…`, verified | **empty** | "Property Consulting"; finance and solicitor invites opened the prime; portal notifications and step-up codes refused |
| NPC Test (`umrtusxohxjxzodxorim`) | domain deleted at Resend on 14 Sep | **empty** | nothing arrived |
| NPC CRM Independent (`qvuwrvwzjyigptmnijyb`) | never finished: the first attempt hit the old plan's domain limit and was never retried, and the domain it later got waits on one DNS record | **empty** | nothing arrived |

The four faults:

1. **The name.** `getBrandConfig()` reads the organisation from
   `global_report_settings.contact_details`. On three clones that table is
   empty, so their invites, notifications and alerts came from "Property
   Consulting". Mission Control writes each clone's own name into its
   environment as `MISSION_CONTROL_AGENCY_NAME`, and no email read it.
2. **The links.** The finance and solicitor portal invites were pinned to the
   prime's `https://command-centre.npcservices.com.au`, "so preview URLs can
   never leak into an invite". On a clone that pin was the leak: a partner
   invited by one tenant was sent to another tenant's application, where the
   token means nothing. The client invite fell back to the prime's Lovable
   URL, the portal notifier to the Lovable editor, and the AML acknowledgement
   and Passport links to the prime's domain.
3. **The sender.** The portal notifier and the AML step-up code sent from a
   literal address on the prime's domain, and the call alert sent from the
   contact address. A clone's key is scoped to its own `send.<clone>` domain,
   so Resend refused all three with a 403. Clients never received portal
   notifications, and nobody on a clone could receive a step-up code.
4. **The contact.** `contactEmail` falls back to the prime's mailbox, so a
   clone's footers and `List-Unsubscribe` named another business.

## The rule

| What | Where it comes from, in order |
| --- | --- |
| Organisation name | `contact_details.company_name` → `whitelabel_settings.company_name` (the Branding page) → `MISSION_CONTROL_AGENCY_NAME` → "Property Consulting" |
| From address | `getBrandConfig().senderEmail`, unchanged: `RESEND_FROM_EMAIL` → `contact_details.email` → the legacy literal. This module never chooses an address. |
| Reply-To | The tenant's own contact address (`contact_details.email`, then the Branding page's signature email), only when the mail leaves from the provisioned sending mailbox and the contact is different. The sending mailbox is never offered as a contact. |
| Link origin | Prime: the origin that call site always used. Clone: the first of `PUBLIC_APP_URL`, `APP_URL`, `APP_BASE_URL` that is not a prime host, a preview or a localhost. If there is none, there is no link. |

Four rules carry it.

- **The tenant's own settings win.** Mission Control's name is used only where
  the tenant has set nothing, and the generic word only where neither exists.
- **A clone never falls back to the prime.** A deployment counts as the prime
  only when `SUPABASE_URL` is the prime's own project. A test harness,
  `supabase start` and a missing variable are all treated as clones, so a
  prime literal can never be the default.
- **An invitation with nowhere to point is refused before anything is
  written.** The client, finance and solicitor invites resolve the origin
  first and answer 500 with nothing created. An invitation stored and never
  delivered is worse than a refusal, and a link into another tenant's
  application is worse than no link. Every existing clone has an origin
  provisioned, so no existing clone is refused.
- **A read that failed is not an empty table.** It is logged and never
  cached, and the identity falls back to what Mission Control provisioned,
  which can only ever name this deployment.

## Every send site

`src/lib/__tests__/emailIdentity.contract.spec.ts` finds every Resend send in
`supabase/functions/` and fails on one it cannot classify. A new send site has
to be added to one of its lists.

| File | Sends | Now |
| --- | --- | --- |
| `_shared/portal-notification-email.ts` | client portal notifications (from `client-portal-login`, `manage-client-data`, `manage-portal-client-data`, `portal-book-appointment`) | deployment sender and name; decides the organisation itself instead of taking it from callers; the button is drawn only when there is an origin |
| `admin-user-management` | staff invitation | deployment name and sender |
| `aml-reliance` | Passport link, partner acknowledgement | deployment name and sender; `issuer_name` is the deployment's |
| `aml-step-up` | step-up code | "&lt;Organisation&gt; Security" from the deployment's sender; clones can now receive codes |
| `client-portal-invite` | client portal invitation | clone origin; refused before any write if none |
| `finance-portal-invite` | finance portal invitation | clone origin instead of the prime pin; refused before any write if none |
| `solicitor-portal-invite` | solicitor portal invitation | clone origin instead of the prime pin; refused before any write if none |
| `portal-book-appointment` | appointment confirmations | deployment name and sender |
| `report-qa` | Q&A email | deployment name, sender and contact footer |
| `send-call-alert-email` | call alert | deployment sender, no longer the contact address |
| `send-weekly-call-report` | weekly call report | deployment name and sender |
| `_shared/aml/directAcknowledgement.ts` | (builds the AML public links) | `deploymentLinkOrigin`, the same rule |

The workflow "Send an email" step is the author's mail: its From is whatever
the author typed, else the Resend integration's Default From address. Its
placeholders no longer show the prime's brand.

## Password recovery is deliberately not here

`admin-password-reset`, `client-portal-forgot-password`,
`finance-portal-forgot-password` and `solicitor-portal-forgot-password` keep
using `getBrandConfig()` directly, as the owner asked, and `brand-config.ts` is
unchanged. They already send from a clone's own address, because that rule
lives in brand-config. On a clone whose settings are empty their display name
is still "Property Consulting" until the tenant fills in its Branding page.

## A new clone has this from its first email

Nothing has to be filled in. When Mission Control provisions a clone it writes:

- `RESEND_FROM_EMAIL` and a domain-scoped `RESEND_API_KEY`, together, once the
  clone's `send.<clone>` domain can send;
- `MISSION_CONTROL_AGENCY_NAME`, the clone's name;
- `PUBLIC_APP_URL`, `APP_URL` and `APP_BASE_URL`, the clone's own origin.

Those are exactly the facts this module reads, so a clone with empty settings
sends under its own name, from its own domain, with links into its own
application.

## Changes the prime can see

The prime's own mail keeps its sender and name, with these exceptions:

- Portal notifications leave from the prime's brand-config sender (its contact
  address) instead of a separate literal notifications address.
- The step-up code is from "&lt;organisation&gt; Security" at the same sender,
  instead of "Property Consulting Security".
- The client and finance invitations no longer carry the "Property Investment
  Advisory" tagline under the name, because a clone is not necessarily an
  advisory business.
- With `APP_URL` unset or a preview, the client invite and the portal notifier
  link to `command-centre.npcservices.com.au` instead of a Lovable URL.
