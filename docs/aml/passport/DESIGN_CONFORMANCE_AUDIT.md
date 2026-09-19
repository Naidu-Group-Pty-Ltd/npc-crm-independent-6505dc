# Passport — Design Conformance Audit

Audit of what was **built** against the Claude Design
(`AML Compliance Passport.dc.html`, project `a663070e-…`, design unchanged
since the 2026-08-13T09:20Z sync). Measured by reading the design's own
element inventory and grepping the shipped source — not from the phase
reports.

> **STATUS: CLOSED.** The gaps below were closed in the "close the gap"
> change (Journey, Ownership & Control, Screening, Funding & EDD pages;
> disclosure matrix; Passport controls; authenticity; client journey page).
> The findings are retained verbatim as the record of what was missing and
> why. See §6 for what remains deliberately deferred.

**Verdict at time of audit: the build was a SUBSET of the design.** 8 of the design's 12
Command Centre pages exist; 4 do not. Several interaction surfaces in the
design (controls, notification drawer, disclosure matrix, document viewer,
authenticity, portal preview) are absent. The projection layer beneath is
sound and carries most of the missing pages' data — the gap is mostly UI,
except Ownership and Journey, which need projection work too.

## 1. Command Centre pages

| # | Design page | Built? | Note |
|---|---|---|---|
| 00 | AML/CTF Journey | **NO** | The design's "source of truth" page — phased milestones, actor, portal, "populates →" chips. Not built; projection carries no journey model |
| 01 | Overview | YES (adapted) | Built as component tiles + fingerprint block. Design's identity-summary card, big stamp, connected-portals grid and authenticity action are not reproduced |
| 02 | Identity | YES (partial) | Allow-listed fields only. Design's portrait (deferred: security), primary-ID-document card, entity particulars panel and MRZ strip absent |
| 03 | Verification | YES | Component cards with status + timing; scores correctly withheld |
| 04 | Ownership & Control | **NO** | Control-structure rows, %, per-party evidence, summary tiles. Projection carries no ownership parties |
| 05 | Screening | **NO** | Screening cards, currency, and the "INTERNAL BOUNDARY — not part of the Passport" panel. Projection **does** carry the summary; only the page is missing |
| 06 | Funding & EDD | **NO** | Source-of-funds composition, evidence state, compliance-decision card. Projection **does** carry the summary; only the page is missing |
| 07 | Evidence & Documents | YES (partial) | Flat list built. Design's category grouping, per-document access chips, "View securely" and "Audit" actions absent |
| 08 | Transaction | YES | N transactions supported (design showed one) |
| 09 | Partner Access | YES (partial) | Partner cards built. **Disclosure matrix table absent** |
| 10 | Stamps & Certifications | YES | Register + per-stamp record dialog; earned from records |
| 11 | Passport History | YES | Append-only, audience-filtered |
| — | Version register | YES | Design has it as a drawer; built as a tab |

**Pages: 8 of 12.**

## 2. Chrome and interaction surfaces

| Design surface | Built? | Status |
|---|---|---|
| Passport identity strip | YES (partial) | Name, credential, state, version, fingerprint. Cover thumbnail and "View digital passport" button absent from Command |
| Version register | YES | |
| Stamp record modal | YES | |
| **Passport controls** — Request client information, Share Passport, Create new version | **NO** | Deliberate Phase 2 decision (not duplicating existing MLRO controls) — but the design expects them here, and the master prompt §30 lists them |
| **Restricted actions** — Suspend, Revoke, Set Refresh Required | **NO** | States derive correctly; no way to *invoke* them from the Passport |
| **Notification drawer** ("Passport activity") | **NO** | No passport events added to any notification feed |
| **Disclosure matrix** | **NO** | |
| **Secure document viewer + access audit modal** | **NO** | |
| **Authenticity / "Verify integrity"** | **NO** | Fingerprint is displayed, but not the verification action |
| **Portal switcher / preview-as-client** | **NO** | Deferred by reconciliation (auth-domain reasons) — but no preview was built either |
| Passport cover (navy leather) | YES (client only) | Not offered in Command |
| Digital booklet | YES (simplified) | ~8 pages vs the design's 16; single page vs two-page spread; no page-turn animation, spine or guilloche ring seals |
| Client portal view | YES | |
| Partner view | YES (Phase 4 strip) | Design marked partner views "design pass pending", so this exceeds the design's own scope |

## 3. Deliberate, documented deferrals (not defects)

These were classified DEFER in `PASSPORT_DESIGN_RECONCILIATION.md` for
security/legal reasons and remain correctly unbuilt: QR/public verification,
client biometric portrait, per-document partner ACLs, true four-eyes
authorisation, printable booklet PDF, identifier unmask-with-reason.

## 4. Honest characterisation

- **Architecture: conformant.** One projection, one derived state, one stamp
  vocabulary, zero new record tables, partner disclosure untouched. The
  design's own thesis ("the Passport is generated from this journey — it is
  not a separate record") is implemented faithfully.
- **Coverage: partial.** Roughly two-thirds of the design's pages and under
  half of its interaction surfaces exist.
- **Fidelity: reduced.** The booklet is materially plainer than the design's
  premium treatment.

Anyone reading the phase reports alone could conclude the design was
implemented in full. It was not, and this document is the correction.

## 5. What closing the gap requires

| Work | Effort | Needs backend? |
|---|---|---|
| Screening page | Small | No — projection already carries it |
| Funding & EDD page | Small | No — projection already carries it |
| Ownership & Control page | Medium | Yes — add parties to the projection |
| AML/CTF Journey page | Medium | Yes — add a journey model to the projection |
| Passport controls + restricted actions | Medium | Wire to existing MLRO ops; no new ops |
| Disclosure matrix | Small | No — manifests already available |
| Secure document viewer + access audit | Medium | Reuse existing signed-URL ops |
| Authenticity action | Small | No |
| Booklet fidelity (spread, turn, 16 pages) | Medium | No |
| Notification drawer / passport events | Small | Reuse existing feeds |

---

## 6. Closure record

Closed:

| Gap | Closed by |
|---|---|
| 00 AML/CTF Journey page | `passportJourney.pure.ts` — derived from the SAME facts as the stamps, so journey and stamps cannot disagree. No new query. Command page + client booklet page |
| 04 Ownership & Control | Ownership parties added to the projection (owners + authorised representatives, names/roles/percent/state only); Command page with UBO and verification summary |
| 05 Screening | Command page over the existing projection summary, including the design's "internal boundary — not part of the Passport" panel |
| 06 Funding & EDD | Command page over the existing projection summary; decision facts only, reasoning stays internal |
| Disclosure matrix | Built from the stored `aml.disclosure_manifests` (allowed codes minus denied, denied winning). v1 grants have no manifest and the page says so rather than implying an empty matrix means "nothing" |
| Passport controls | `PassportControls` wired to canonical ops — `issue_attestation`, and `set_service_gate` (`locked`/`terminated`) for suspend/revoke, MLRO-gated server-side with a mandatory reason. Sharing and client requests point at the Compliance Sharing panel that owns their inputs |
| Authenticity / verify integrity | Dialog over the sealed fingerprint and version |
| Entity particulars | Entity register is now canonical for particulars; the questionnaire fills gaps |

**Client-boundary note.** Adding the journey to the client booklet initially
carried operational vocabulary ("sanctions", "PEP", "risk assessment") into a
client surface. Rather than loosening the contract test, the journey now
carries **client-safe wording** per milestone: the client is told the
milestone happened, in their words. A new contract test pins that no
operational vocabulary can re-enter the client journey.

**Client ownership page:** deliberately NOT added. The client-portal function
is contract-bound never to read `beneficial_owners`; the client sees their
verified parties on the Verification page instead.

Still deferred (unchanged, by design): QR/public verification, client
biometric portrait, per-document partner ACLs, four-eyes authorisation,
printable booklet PDF, identifier unmask-with-reason, portal switcher
(Command preview-as-client), notification-drawer passport events, and full
booklet fidelity (two-page spread, page-turn animation, 16 pages).
