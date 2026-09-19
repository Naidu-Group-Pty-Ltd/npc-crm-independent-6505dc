-- The AML/CTF Compliance Passport Agreement, written for the LINK channel.
--
-- ── Why a distinct text, not a copy ──────────────────────────────────────
-- The `direct` row published in 20261001000100 was a verbatim copy of the
-- portal agreement, because the instrument is the same and copying beat
-- retyping. But it asks a partner to accept terms about a Portal they are
-- never given: accounts, login credentials, multi-factor authentication,
-- cross-portal sharing, per-matter permissions. A partner outside the three
-- portals receives ONE THING — a time-limited link to an Aurixa Systems
-- Compliance Passport — and an agreement should describe what is actually
-- being granted. Asking someone to accept obligations about a system they
-- have no access to is both confusing and, for the clauses that would
-- otherwise govern their conduct, unenforceable in substance.
--
-- ── What is preserved, deliberately and completely ───────────────────────
-- Every AML/CTF provision is carried across unchanged in substance: the
-- section 37A / Rule 6-29 conditions for reliance (§7), the Originating and
-- Partner Organisation responsibilities (§8, §9), restricted AML/CTF
-- information and tipping-off (§11), the review/suspension regime and the
-- section 37B assessment record within 10 business days (§12), audit and
-- retention (§13), and the role of Aurixa Systems (§14). Confidentiality,
-- privilege and privacy survive intact. The four mandatory acknowledgments
-- keep their KEYS — `global_confidentiality_privacy`,
-- `authority_binding_acceptance`, `portal_access`,
-- `binding_amlctf_arrangement` — so the server's required-acknowledgment
-- check and every portal acceptance are untouched; only the STATEMENT the
-- direct partner reads under the third key is written for the link.
--
-- ── What changes ─────────────────────────────────────────────────────────
-- The access mechanism. §2 becomes Passport Link access: one link, no
-- account, no password, valid for a fixed period (90 days), not to be
-- forwarded, re-issuable on request. §5 becomes link-handling security
-- rather than credential and MFA hygiene. §15 becomes expiry, re-issue and
-- withdrawal. References to "the Portal" become "the Passport Link" or
-- "the Compliance Passport" according to which is actually meant.
--
-- The previous direct row is RETIRED rather than edited: an executed
-- acceptance must keep pointing at the exact text that was accepted, and
-- `portal_terms_acceptances`/`direct_partner_acknowledgements` reference the
-- version row by id. Nothing already accepted changes.

UPDATE public.portal_terms_versions
   SET retired_at = now()
 WHERE portal = 'direct'
   AND retired_at IS NULL;

INSERT INTO public.portal_terms_versions
  (portal, version, title, content_markdown, published_at, effective_at, document_hash)
SELECT
  'direct',
  '2026-10-01',
  'AML/CTF Compliance Passport Link Agreement',
  md.body,
  now(),
  now(),
  encode(sha256(md.body::bytea), 'hex')
FROM (SELECT $md$## Global Confidentiality and Privacy Acknowledgment

Before opening the Compliance Passport Link, the Partner Organisation acknowledges and agrees that all client, transaction, matter, document, compliance and AML/CTF information made available through the Link is confidential and may contain personal, sensitive, commercially confidential or legally privileged information.

The Partner Organisation agrees that it will:

1. access information only for an authorised client, matter, transaction or professional purpose;
2. restrict access to authorised personnel with a genuine need to know;
3. use and disclose information only for the purpose for which access was granted;
4. comply with applicable privacy, confidentiality, professional conduct and information-security obligations;
5. not disclose information to another person or organisation without lawful authority;
6. protect all information against misuse, interference, loss and unauthorised access, modification or disclosure;
7. immediately report any suspected privacy, confidentiality or security incident; and
8. remain bound by these obligations after the Link expires or this Agreement ends.

Where the Privacy Act 1988 and Australian Privacy Principles apply, personal information must be handled transparently and securely and only collected, used or disclosed for an authorised or legally permitted purpose.

## 1. Binding acceptance and authority

By selecting the mandatory acknowledgments and accepting this Agreement, the person accepting confirms that:

1. they are authorised to act for and bind the Partner Organisation;
2. they have obtained any required internal, management or compliance approval;
3. the Partner Organisation agrees to be legally bound by this Agreement;
4. electronic acceptance is intended to constitute execution of this Agreement;
5. the information supplied about the Partner Organisation and its authority is accurate; and
6. the Partner Organisation consents to receiving and accepting agreements, notices and records electronically.

The Originating Organisation records the accepting person's name, the organisation accepted for, the acceptance date and time, the network address and browser from which acceptance was made, the Agreement version, the document hash and the acknowledgments asserted.

Australian electronic-transactions legislation recognises electronic transactions and permits electronic signatures where the method identifies the person, indicates their intention and is sufficiently reliable for the relevant purpose.

## 2. The Compliance Passport Link and permitted use

The Partner Organisation is not given a portal account, a username or a password. Access is provided as a **single, time-limited web link** to an Aurixa Systems AML/CTF Compliance Passport for one client and matter.

The Partner Organisation acknowledges that:

1. the link is itself the access credential, and anyone holding it can open the Compliance Passport;
2. the link is valid for a limited period — ordinarily **90 days** from issue — and stops working when that period ends;
3. the link may be withdrawn earlier by the Originating Organisation;
4. the link is issued for one Compliance Passport and does not provide access to any other client, matter or system;
5. a replacement link may be requested from the page itself once the period has ended, or from the Originating Organisation at any time; and
6. a replacement link supersedes the previous one, which immediately stops working.

The Partner Organisation may use the Compliance Passport Link only for:

- the authorised client and property transaction it was issued for;
- professional services being provided by the Partner Organisation;
- compliance and customer due-diligence activities;
- reviewing the authorised AML/CTF Compliance Passport; and
- recording its own determination in respect of that Passport.

The Partner Organisation must not:

- forward, publish, post or otherwise disclose the link to any person outside the authorised personnel described above;
- use the link, or information obtained through it, for an unrelated purpose, curiosity, personal benefit, marketing or prospecting;
- attempt to alter the link, or to reach any client, matter or record other than the one it was issued for;
- copy or distribute information beyond what is reasonably required for the authorised purpose; or
- interfere with the service, or with another organisation's information.

Access is limited to the client, matter and Compliance Passport version the link was issued for.

## 3. Confidentiality and legal professional privilege

The Partner Organisation must keep all information obtained through the Compliance Passport Link confidential and apply appropriate professional, contractual and legal protections.

Information marked as legally privileged must not be disclosed, copied, downloaded or shared unless the Partner Organisation has confirmed that the disclosure is authorised and will not improperly waive privilege.

The Parties acknowledge that:

- making information available through the Link does not automatically create legal professional privilege;
- marking information as privileged does not guarantee that it is legally privileged;
- access does not transfer privilege from one person or organisation to another; and
- each professional organisation remains responsible for determining whether material is privileged and whether it may lawfully be disclosed.

Privileged legal advice, internal legal strategy and confidential solicitor notes must not form part of an AML/CTF Compliance Passport unless their inclusion has been specifically authorised and is legally appropriate.

## 4. Privacy and information sharing

The Partner Organisation acknowledges that information is disclosed to it to support a connected property transaction.

That disclosure is:

- connected to an authorised client and transaction;
- limited to the minimum information reasonably required;
- supported by client consent or another lawful basis;
- restricted to the Partner Organisation named in this Agreement;
- subject to expiry, withdrawal and revocation controls; and
- recorded in the Originating Organisation's audit trail.

The Partner Organisation must not use information obtained through the Link for a secondary or unrelated purpose unless permitted by law and properly authorised.

Each Party remains responsible for its own privacy notices, collection practices, lawful basis, data handling, access and correction processes, security controls and data-breach obligations.

Withdrawal of a client's optional sharing consent will apply prospectively. It will not invalidate a lawful disclosure already completed or require deletion of records that must be retained by law.

## 5. Handling the link, and incident management

Because the link is the credential, the Partner Organisation must:

1. treat the link with the same care as a password, and keep it within authorised personnel;
2. not send the link over an unsecured or public channel, or store it where unauthorised persons may find it;
3. prevent unauthorised persons from viewing the Compliance Passport on screen or in print;
4. maintain reasonable device, browser and network security;
5. ensure personnel who leave, or who no longer require access, do not retain the link;
6. promptly report any suspected misdirection, forwarding, loss or unauthorised disclosure of the link or of information obtained through it; and
7. cooperate with reasonable security, containment and investigation requirements.

The Originating Organisation or Aurixa Systems may withdraw a link at any time where it reasonably considers that continued access creates a confidentiality, privacy, compliance or security risk. A withdrawn link is not renewable from the page; a further link may be issued only as a fresh decision of the Originating Organisation.

## 6. Nature of the AML/CTF Compliance Passport

The Compliance Passport Link makes an Aurixa AML/CTF Compliance Passport available for an authorised client or transaction.

The Compliance Passport may contain authorised information concerning:

- the client or entity verified;
- representatives, beneficial owners or controllers;
- the Originating Organisation;
- KYC information collected;
- verification procedures completed;
- verification date and status;
- the categories of evidence used;
- availability of supporting verification data;
- the transaction or designated-service scope;
- Passport version and issue date; and
- expiry, refresh, suspension, supersession or revocation status.

The Compliance Passport is a digital compliance record. It is not:

- a government-issued passport;
- an identity document;
- an AUSTRAC approval or certification;
- a guarantee that a client presents no AML/CTF risk;
- a universal compliance clearance;
- a substitute for ongoing or enhanced customer due diligence; or
- automatic authority for every organisation to rely on previous verification.

## 7. Binding customer due-diligence arrangement

Subject to this section, the Parties intend the AML/CTF provisions of this Agreement to constitute a written customer due-diligence agreement or arrangement for the purposes of section 37A of the Anti-Money Laundering and Counter-Terrorism Financing Act 2006 and section 6-29 of the Anti-Money Laundering and Counter-Terrorism Financing Rules 2025.

The Partner Organisation may rely on customer due-diligence procedures performed by the Originating Organisation only where:

1. the Originating Organisation is a reporting entity or another person legally eligible under the AML/CTF Rules;
2. the Originating Organisation has measures in place to comply with its applicable CDD and record-keeping obligations;
3. the Partner Organisation has reasonable grounds to believe the legislative and Rules requirements are satisfied;
4. the arrangement is appropriate to the money-laundering, terrorism-financing and proliferation-financing risks faced by the Partner Organisation;
5. the Compliance Passport covers the relevant client, transaction and designated service;
6. all required KYC information can be obtained before the designated service begins, subject to any lawful delayed-CDD exception;
7. copies of the data used to verify KYC information can be obtained immediately or as soon as practicable following a request;
8. the arrangement remains in force and has not been suspended or terminated;
9. the required assessment of the arrangement remains current; and
10. the Partner Organisation records its decision to rely on the relevant Passport version.

These conditions reflect the requirements imposed by section 37A and Rule 6-29.

Where these requirements are not satisfied, the Compliance Passport must be treated as information only, and the Partner Organisation must complete any customer due diligence required under its own AML/CTF program.

The expiry of a Compliance Passport Link does not of itself end the section 37A arrangement, and the continuation of a link does not of itself keep the arrangement current. The two are separate: the link controls access, and this section controls reliance.

## 8. Originating Organisation responsibilities

The Originating Organisation agrees to:

1. maintain measures designed to comply with its applicable CDD and record-keeping obligations;
2. collect and verify KYC information in accordance with its AML/CTF program and applicable law;
3. maintain records supporting the Compliance Passport;
4. make the relevant collected KYC information available within the required timeframe;
5. provide copies of verification data immediately or as soon as practicable following a lawful and properly authorised request;
6. keep the Passport's issue, expiry, refresh and revocation status reasonably current;
7. notify the Partner Organisation when a known material change may affect reliance;
8. protect confidential, privileged and restricted AML information; and
9. maintain an auditable record of Passport creation, link issue and authorised disclosure.

The Originating Organisation does not guarantee that its procedures will be sufficient for every Partner Organisation, designated service or customer-risk circumstance.

## 9. Partner Organisation responsibilities

Before relying on a Compliance Passport, the Partner Organisation agrees to:

1. confirm its own eligibility to rely;
2. assess whether reliance is appropriate to its particular AML/CTF risks;
3. confirm that this Agreement and the relevant arrangement remain active;
4. confirm that the Passport applies to the correct client, transaction and designated service;
5. review the relevant KYC information and verification status;
6. request supporting evidence where reasonably required;
7. record the decision to accept, reject or condition reliance;
8. undertake additional, enhanced or independent customer due diligence where required;
9. maintain records required by its AML/CTF program and applicable law;
10. undertake its own ongoing customer due diligence;
11. comply with its own suspicious-matter, reporting and escalation obligations; and
12. stop relying where it no longer has reasonable grounds to believe the applicable requirements are satisfied.

Reliance does not transfer the Partner Organisation's AML/CTF responsibility to the Originating Organisation or Aurixa Systems. Completing the Partner Organisation's own independent customer due diligence remains available at all times and is a matter for its own judgment.

## 10. Information requests and supporting evidence

The Partner Organisation may request additional KYC information or verification data from the Originating Organisation where reasonably required for an authorised AML/CTF purpose.

The request must:

- relate to an authorised client and transaction;
- identify the relevant compliance purpose;
- be limited to information reasonably required;
- comply with applicable privacy and confidentiality obligations; and
- not seek restricted information that cannot lawfully be disclosed.

The Originating Organisation may approve, partially approve, defer or refuse a request where disclosure:

- is outside the scope of this Agreement;
- is not properly authorised;
- is legally privileged;
- would breach privacy or confidentiality obligations;
- could create an unlawful tipping-off risk; or
- is otherwise prohibited by law.

## 11. Restricted AML/CTF information

Unless expressly authorised and lawful, the Partner Organisation must not request, access, use or disclose:

- suspicious matter reports;
- information revealing that a suspicious matter report has been or may be submitted;
- internal suspicion assessments;
- internal risk scores;
- detailed sanctions or PEP investigation notes;
- MLRO deliberations;
- law-enforcement information;
- AUSTRAC communications;
- internal investigation records; or
- information whose disclosure could prejudice an investigation.

The Compliance Passport presents only the status and evidence information approved for lawful partner disclosure.

## 12. Review, suspension and termination of reliance

While the section 37A arrangement remains in force, the Partner Organisation must assess whether it continues to satisfy the AML/CTF Rules:

- at intervals appropriate to its AML/CTF risks and not exceeding two years; and
- when a significant change in circumstances may affect the arrangement.

A written record of an assessment under section 37B must be prepared within 10 business days after the assessment is completed.

Reliance must be suspended where:

- either Party ceases to be eligible;
- the arrangement assessment becomes overdue;
- required KYC information or verification data cannot be obtained;
- a material breach or significant change affects the arrangement;
- the relevant Passport expires or is revoked;
- the Partner Organisation no longer considers reliance appropriate; or
- suspension is otherwise required by law.

Suspension of reliance does not necessarily withdraw an unexpired Compliance Passport Link. The Passport may remain available on an information-only basis where lawful and authorised.

## 13. Audit records and retention

The Parties authorise the Originating Organisation and Aurixa Systems to record:

- the accepting person's identity and authority;
- the participating organisations;
- the Agreement version and document hash;
- acceptance date and time;
- issue, expiry, re-issue and withdrawal of a Compliance Passport Link;
- each occasion the Compliance Passport is opened;
- supporting-evidence requests;
- reliance decisions and independent determinations;
- arrangement reviews;
- material changes;
- suspensions and revocations; and
- relevant security and administrative events.

Each Party remains responsible for retaining the records it is legally required to retain.

Termination or withdrawal does not require deletion of information that must be retained under AML/CTF, privacy, professional, litigation-hold or other applicable requirements.

## 14. Role of Aurixa Systems

Aurixa Systems provides the technology used to facilitate:

- issue and expiry of Compliance Passport Links;
- Compliance Passport creation and display;
- information exchange;
- version management;
- access records; and
- audit trails.

Unless separately identified as the reporting entity that performed the relevant customer due diligence, Aurixa Systems is not:

- the entity whose KYC procedure is being relied upon;
- responsible for either Party's AML/CTF program;
- responsible for the Partner Organisation's reliance decision;
- a substitute for either Party's professional judgment; or
- providing legal or regulatory advice.

The section 37A arrangement is between the named Originating Organisation and Partner Organisation.

## 15. Expiry, re-issue and withdrawal of the Link

A Compliance Passport Link ends when the earliest of the following occurs:

- the fixed period from issue elapses (ordinarily 90 days);
- a replacement link is issued, superseding it;
- the Originating Organisation withdraws it; or
- the underlying Compliance Passport is superseded, refreshed or revoked.

A link may also be withdrawn or refused where:

- the accepting person's authority ends;
- the Partner Organisation's engagement or matter involvement ends;
- this Agreement is breached;
- access creates a privacy, confidentiality, privilege, AML/CTF or security risk;
- access was obtained using inaccurate or misleading information;
- a client authority or lawful access basis expires;
- the relevant organisation relationship ends; or
- restriction is required by law.

Where a link has simply expired, the Partner Organisation may request a replacement, and the Originating Organisation will decide whether to issue one. A replacement carries the Compliance Passport as it stands at the time of re-issue, which may differ from the version previously seen.

Confidentiality, privacy, security, record-keeping and authorised-use obligations survive expiry, withdrawal and termination.

## 16. Changes to this Agreement

Material changes to this Agreement must be:

- allocated a new version;
- linked to a new document hash;
- presented to the Partner Organisation; and
- accepted by an appropriately authorised person before the amended terms take effect.

Historic acceptance records must not be overwritten.

A change to the AML/CTF Act, AML/CTF Rules, regulatory guidance or the Parties' circumstances may require this Agreement and the associated reliance assessment to be reviewed.

## 17. General provisions

**Entire agreement**

This Agreement records the agreement between the Parties concerning access to an AML/CTF Compliance Passport by link, confidentiality, privacy and use of that Passport.

Any separate services agreement, data-processing agreement, professional engagement, client authority or operational schedule continues to apply.

**Inconsistency**

Where there is an inconsistency, the more specific agreement governing the relevant matter will apply to the extent of that inconsistency, provided it does not reduce a mandatory legal obligation.

**Severability**

If a provision is invalid or unenforceable, it will be read down where possible. The remaining provisions continue to apply.

**No waiver**

A failure or delay in enforcing a right does not waive that right.

**Governing law**

This Agreement is governed by the laws of each State or Territory, Australia.

## Mandatory acknowledgments

**1. Global confidentiality and privacy**

I acknowledge that all information made available through the Compliance Passport Link is confidential and may include personal, sensitive, commercially confidential or legally privileged information. I agree that my organisation will access, use, protect and disclose that information only for an authorised client, transaction and lawful professional purpose.

**2. Authority and binding acceptance**

I confirm that I am authorised to accept this Agreement and legally bind the Partner Organisation identified above. I agree that my electronic acceptance will constitute execution of this Agreement on behalf of the Partner Organisation.

**3. Compliance Passport Link access**

I acknowledge that access is provided as a single, time-limited link rather than a portal account, that the link is itself the credential and must not be forwarded outside authorised personnel, and that it will expire — ordinarily after 90 days — unless a replacement is issued.

**4. Binding AML/CTF arrangement**

I acknowledge and agree that, where the applicable eligibility and legislative requirements are satisfied, this Agreement is intended to constitute a binding customer due-diligence agreement or arrangement between the Originating Organisation and Partner Organisation for the purposes of section 37A of the AML/CTF Act and section 6-29 of the AML/CTF Rules.
$md$ AS body) md;
