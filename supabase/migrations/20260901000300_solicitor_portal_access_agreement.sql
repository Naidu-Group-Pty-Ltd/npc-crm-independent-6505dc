-- Solicitor Portal: publish the Portal Access, Confidentiality, Privacy and
-- AML/CTF Compliance Passport Agreement, and record what the agreement says the
-- Portal records.
--
-- The version this replaces ('2026-07-30') carried a single sentence — "Use of
-- this portal is subject to confidentiality, privacy, professional obligations,
-- and authorised matter access." — against which every existing acceptance was
-- taken. Those acceptances are the record of what those users agreed to, so the
-- old version is RETIRED, never rewritten: section 16 of the new agreement
-- ("Historic acceptance records must not be overwritten") is the same rule the
-- schema already enforced by keying an acceptance to a version id.
--
-- Retiring it re-gates every solicitor. `resolveSolicitorSession` computes
-- `has_accepted_current_terms` as "an acceptance exists against the current
-- version", so publishing a new current version sends every user back through
-- /solicitor/terms. That is the intent, not a side effect: section 16 requires
-- a material change to be accepted by an appropriately authorised person before
-- the amended terms take effect.
--
-- Two columns are added because the agreement itself promises them:
--   * portal_terms_versions.document_hash — section 16 requires a material
--     change to be "linked to a new document hash". Maintained by trigger
--     rather than by the inserting statement so a version cannot be published
--     with a hash of something other than its own text. (A GENERATED column
--     cannot do this: convert_to() is STABLE, not IMMUTABLE.)
--   * portal_terms_acceptances.acknowledgements — the agreement states the
--     Portal may record "acknowledgment history", and the five mandatory
--     acknowledgments are now themselves contractual statements rather than an
--     interface gate. Which ones were asserted is part of the acceptance.
-- Both are nullable: existing acceptances predate them and must not be
-- back-filled with a fiction about what those users were shown.

-- ===========================================================================
-- 1. Document hash on every terms version
-- ===========================================================================
ALTER TABLE public.portal_terms_versions
  ADD COLUMN IF NOT EXISTS document_hash text;

CREATE OR REPLACE FUNCTION public.set_portal_terms_document_hash()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.document_hash := encode(sha256(convert_to(NEW.content_markdown, 'UTF8')), 'hex');
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.set_portal_terms_document_hash() IS
  'Derives portal_terms_versions.document_hash from content_markdown on every write. The hash is never supplied by the caller, so a published version cannot carry the hash of a different document.';

DROP TRIGGER IF EXISTS trg_set_portal_terms_document_hash ON public.portal_terms_versions;
-- Deliberately not `UPDATE OF content_markdown`: narrowing it to that column
-- would let an update that touches only document_hash store a hash of some
-- other document, which is precisely the claim the hash exists to make.
CREATE TRIGGER trg_set_portal_terms_document_hash
  BEFORE INSERT OR UPDATE
  ON public.portal_terms_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_portal_terms_document_hash();

-- Back-fill the versions that already exist. This is a derivation from text
-- already stored, not a change to any agreement.
UPDATE public.portal_terms_versions
   SET document_hash = encode(sha256(convert_to(content_markdown, 'UTF8')), 'hex')
 WHERE document_hash IS NULL;

COMMENT ON COLUMN public.portal_terms_versions.document_hash IS
  'SHA-256 (hex) of content_markdown, maintained by trg_set_portal_terms_document_hash. Shown on the consent wall and recorded in the acceptance audit entry so an acceptance can be tied to the exact bytes that were displayed.';

-- ===========================================================================
-- 2. Acknowledgment history on every acceptance
-- ===========================================================================
ALTER TABLE public.portal_terms_acceptances
  ADD COLUMN IF NOT EXISTS acknowledgements jsonb;

-- A jsonb array of acknowledgment keys, or nothing at all. Anything else — an
-- object, a string, a number — would make the column unreadable as a history.
ALTER TABLE public.portal_terms_acceptances
  DROP CONSTRAINT IF EXISTS portal_terms_acceptances_acknowledgements_shape;
ALTER TABLE public.portal_terms_acceptances
  ADD CONSTRAINT portal_terms_acceptances_acknowledgements_shape
  CHECK (acknowledgements IS NULL OR jsonb_typeof(acknowledgements) = 'array') NOT VALID;
ALTER TABLE public.portal_terms_acceptances
  VALIDATE CONSTRAINT portal_terms_acceptances_acknowledgements_shape;

COMMENT ON COLUMN public.portal_terms_acceptances.acknowledgements IS
  'The mandatory acknowledgment keys the accepting person asserted, in the order presented. NULL for acceptances taken before the agreement required them; never back-filled.';

-- ===========================================================================
-- 3. Retire the superseded solicitor version
-- ===========================================================================
-- Scoped to versions other than the one published below so re-applying this
-- migration is a no-op rather than a portal with no current terms at all.
UPDATE public.portal_terms_versions
   SET retired_at = now()
 WHERE portal = 'solicitor'
   AND retired_at IS NULL
   AND version <> '2026-08-06';

-- ===========================================================================
-- 4. Publish the agreement
--
-- The text below is the agreement as supplied by the operator, unaltered. The
-- one substitution is the governing-law field in section 17, which was supplied
-- as a fill-in and is filled in here.
-- ===========================================================================
INSERT INTO public.portal_terms_versions (portal, version, title, content_markdown, effective_at)
VALUES (
  'solicitor',
  '2026-08-06',
  'Portal Access, Confidentiality, Privacy and AML/CTF Compliance Passport Agreement',
$md$## Global Confidentiality and Privacy Acknowledgment

Before accessing the Portal, the Partner Organisation acknowledges and agrees that all client, transaction, matter, document, communication, compliance and AML/CTF information made available through the Portal is confidential and may contain personal, sensitive, commercially confidential or legally privileged information.

The Partner Organisation agrees that it will:

1. access information only for an authorised client, matter, transaction or professional purpose;
2. restrict access to authorised personnel with a genuine need to know;
3. use and disclose information only for the purpose for which access was granted;
4. comply with applicable privacy, confidentiality, professional conduct and information-security obligations;
5. not disclose information to another person or organisation without lawful authority;
6. protect all information against misuse, interference, loss and unauthorised access, modification or disclosure;
7. immediately report any suspected privacy, confidentiality or security incident; and
8. remain bound by these obligations after Portal access or this Agreement ends.

Where the Privacy Act 1988 and Australian Privacy Principles apply, personal information must be handled transparently and securely and only collected, used or disclosed for an authorised or legally permitted purpose.

## 1. Binding acceptance and authority

By selecting the mandatory acknowledgments and clicking Accept Binding Agreement & Continue, the person accepting this Agreement confirms that:

1. they are authorised to act for and bind the Partner Organisation;
2. they have obtained any required internal, management or compliance approval;
3. the Partner Organisation agrees to be legally bound by this Agreement;
4. electronic acceptance is intended to constitute execution of this Agreement;
5. the information supplied about the Partner Organisation and its authority is accurate; and
6. the Partner Organisation consents to receiving and accepting agreements, notices and records electronically.

The Portal may record the accepting person’s identity, organisation, authentication details, acceptance date and time, IP address, user agent, Agreement version, document hash and acknowledgment history.

Australian electronic-transactions legislation recognises electronic transactions and permits electronic signatures where the method identifies the person, indicates their intention and is sufficiently reliable for the relevant purpose.

## 2. Portal access and permitted use

The Partner Organisation may use the Portal only for:

- authorised clients and property transactions;
- professional services being provided by the Partner Organisation;
- lawful communication and document exchange;
- compliance and customer due-diligence activities;
- reviewing an authorised AML/CTF Compliance Passport; and
- requesting information or evidence connected with an authorised matter.

The Partner Organisation must not:

- access matters not assigned to it;
- access information for curiosity, personal benefit or an unrelated purpose;
- use information for unauthorised marketing or prospecting;
- share user accounts or login credentials;
- circumvent Portal permissions or security controls;
- copy or distribute information beyond what is reasonably required; or
- interfere with the Portal, another user or another organisation’s information.

Access is limited to the organisation, matter, transaction and role recorded within the Portal.

## 3. Confidentiality and legal professional privilege

The Partner Organisation must keep all Portal information confidential and apply appropriate professional, contractual and legal protections.

Information marked as legally privileged must not be disclosed, copied, downloaded or shared unless the Partner Organisation has confirmed that the disclosure is authorised and will not improperly waive privilege.

The Parties acknowledge that:

- storing information in the Portal does not automatically create legal professional privilege;
- marking information as privileged does not guarantee that it is legally privileged;
- Portal access does not transfer privilege from one person or organisation to another; and
- each professional organisation remains responsible for determining whether material is privileged and whether it may lawfully be disclosed.

Privileged legal advice, internal legal strategy and confidential solicitor notes must not form part of an AML/CTF Compliance Passport unless their inclusion has been specifically authorised and is legally appropriate.

## 4. Privacy and cross-portal information sharing

The Partner Organisation acknowledges that information may be shared between authorised Aurixa partner portals to support a connected property transaction.

Information sharing must be:

- connected to an authorised client and transaction;
- limited to the minimum information reasonably required;
- supported by client consent or another lawful basis;
- restricted to authorised recipient organisations;
- subject to access expiry, withdrawal and revocation controls; and
- recorded in the Portal audit trail.

The Partner Organisation must not use Portal information for a secondary or unrelated purpose unless permitted by law and properly authorised.

Each Party remains responsible for its own privacy notices, collection practices, lawful basis, data handling, access and correction processes, security controls and data-breach obligations.

Withdrawal of a client’s optional sharing consent will apply prospectively. It will not invalidate a lawful disclosure already completed or require deletion of records that must be retained by law.

## 5. Security and incident management

The Partner Organisation must:

1. maintain secure and unique login credentials;
2. use multi-factor authentication where required;
3. prevent unauthorised persons from viewing Portal information;
4. maintain reasonable device, browser and network security;
5. immediately disable access for personnel who leave or no longer require access;
6. promptly report suspected credential compromise, data loss or unauthorised disclosure; and
7. cooperate with reasonable security, containment and investigation requirements.

The Originating Organisation or Aurixa Systems may suspend access where it reasonably considers that continued access creates a confidentiality, privacy, compliance or security risk.

## 6. Nature of the AML/CTF Compliance Passport

The Portal may make an Aurixa AML/CTF Compliance Passport available for an authorised client or transaction.

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

## 8. Originating Organisation responsibilities

The Originating Organisation agrees to:

1. maintain measures designed to comply with its applicable CDD and record-keeping obligations;
2. collect and verify KYC information in accordance with its AML/CTF program and applicable law;
3. maintain records supporting the Compliance Passport;
4. make the relevant collected KYC information available within the required timeframe;
5. provide copies of verification data immediately or as soon as practicable following a lawful and properly authorised request;
6. keep the Passport’s issue, expiry, refresh and revocation status reasonably current;
7. notify the Partner Organisation when a known material change may affect reliance;
8. protect confidential, privileged and restricted AML information; and
9. maintain an auditable record of Passport creation and authorised disclosure.

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

Reliance does not transfer the Partner Organisation’s AML/CTF responsibility to the Originating Organisation or Aurixa Systems.

## 10. Information requests and supporting evidence

The Partner Organisation may request additional KYC information or verification data through the Portal where reasonably required for an authorised AML/CTF purpose.

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

The Compliance Passport must present only the status and evidence information approved for lawful partner disclosure.

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

Suspension of reliance does not necessarily terminate ordinary Portal access. The Passport may remain available on an information-only basis where lawful and authorised.

## 13. Audit records and retention

The Parties authorise the Portal to record:

- the accepting person’s identity and authority;
- the participating organisations;
- the Agreement version and document hash;
- acceptance date and time;
- Portal and Passport access;
- supporting-evidence requests;
- reliance decisions;
- arrangement reviews;
- material changes;
- suspensions and revocations; and
- relevant security and administrative events.

Each Party remains responsible for retaining the records it is legally required to retain.

Termination or withdrawal does not require deletion of information that must be retained under AML/CTF, privacy, professional, litigation-hold or other applicable requirements.

## 14. Role of Aurixa Systems

Aurixa Systems provides the technology used to facilitate:

- Portal access;
- authentication and permissions;
- Compliance Passport creation and display;
- information exchange;
- version management;
- access records; and
- audit trails.

Unless separately identified as the reporting entity that performed the relevant customer due diligence, Aurixa Systems is not:

- the entity whose KYC procedure is being relied upon;
- responsible for either Party’s AML/CTF program;
- responsible for the Partner Organisation’s reliance decision;
- a substitute for either Party’s professional judgment; or
- providing legal or regulatory advice.

The section 37A arrangement is between the named Originating Organisation and Partner Organisation.

## 15. Suspension and termination of Portal access

Portal access may be suspended or terminated where:

- the user’s authority ends;
- the Partner Organisation’s engagement or matter assignment ends;
- this Agreement is breached;
- access creates a privacy, confidentiality, privilege, AML/CTF or security risk;
- access was obtained using inaccurate or misleading information;
- a client authority or lawful access basis expires;
- the relevant organisation relationship ends; or
- restriction is required by law.

Confidentiality, privacy, security, record-keeping and authorised-use obligations survive termination.

## 16. Changes to this Agreement

Material changes to this Agreement must be:

- allocated a new version;
- linked to a new document hash;
- presented to the Partner Organisation; and
- accepted by an appropriately authorised person before the amended terms take effect.

Historic acceptance records must not be overwritten.

A change to the AML/CTF Act, AML/CTF Rules, regulatory guidance or the Parties’ circumstances may require this Agreement and the associated reliance assessment to be reviewed.

## 17. General provisions

**Entire agreement**

This Agreement records the agreement between the Parties concerning Portal access, confidentiality, privacy and use of the AML/CTF Compliance Passport.

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

I acknowledge that all information made available through the Portal is confidential and may include personal, sensitive, commercially confidential or legally privileged information. I agree that my organisation will access, use, protect and disclose that information only for an authorised client, transaction and lawful professional purpose.

**2. Authority and binding acceptance**

I confirm that I am authorised to accept this Agreement and legally bind the Partner Organisation identified above. I agree that my electronic acceptance will constitute execution of this Agreement on behalf of the Partner Organisation.

**3. Portal access**

I agree that the Partner Organisation will access and use the Portal only for authorised matters and will comply with the Portal access, privacy, confidentiality, security and audit requirements set out in this Agreement.

**4. Binding AML/CTF arrangement**

I acknowledge and agree that, where the applicable eligibility and legislative requirements are satisfied, this Agreement is intended to constitute a binding customer due-diligence agreement or arrangement between the Originating Organisation and Partner Organisation for the purposes of section 37A of the AML/CTF Act and section 6-29 of the AML/CTF Rules.

**5. Independent AML/CTF responsibility**

I acknowledge that access to an Aurixa AML/CTF Compliance Passport does not automatically authorise reliance or satisfy all of the Partner Organisation’s AML/CTF obligations. The Partner Organisation remains responsible for assessing, approving and recording reliance and for completing any additional, enhanced, ongoing or independent customer due diligence required.
$md$,
  now()
)
-- Re-application restores this version as the current one, but only when the
-- stored text is byte-identical. A version whose text has diverged is left
-- exactly as it is: rewriting it would change what accepted users agreed to,
-- and the assertions below will fail rather than let that pass unnoticed.
ON CONFLICT (portal, version) DO UPDATE
  SET retired_at = NULL
  WHERE public.portal_terms_versions.content_markdown = EXCLUDED.content_markdown;

-- ===========================================================================
-- 5. Post-migration assertions
--
-- Fail loudly rather than leave the portal gated on a version that is missing,
-- duplicated or hashless — every one of those is a locked-out solicitor.
-- ===========================================================================
DO $$
DECLARE
  v_current record;
  v_current_count bigint;
  v_hashless bigint;
  v_retired bigint;
BEGIN
  SELECT count(*) INTO v_current_count
  FROM public.portal_terms_versions
  WHERE portal = 'solicitor' AND retired_at IS NULL;
  IF v_current_count <> 1 THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: expected exactly 1 current solicitor terms version, found %', v_current_count;
  END IF;

  SELECT version, title, document_hash, length(content_markdown) AS len
    INTO v_current
  FROM public.portal_terms_versions
  WHERE portal = 'solicitor' AND retired_at IS NULL;

  IF v_current.version <> '2026-08-06' THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: current solicitor version is % rather than 2026-08-06', v_current.version;
  END IF;
  IF v_current.document_hash IS NULL OR length(v_current.document_hash) <> 64 THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: current solicitor version has no usable document hash';
  END IF;

  -- The superseded single-sentence version was ~120 characters. A short body
  -- here means the agreement did not land.
  IF v_current.len < 15000 THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: current solicitor agreement is only % characters', v_current.len;
  END IF;

  SELECT count(*) INTO v_hashless FROM public.portal_terms_versions WHERE document_hash IS NULL;
  IF v_hashless > 0 THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: % terms versions have no document hash', v_hashless;
  END IF;

  -- The superseded version must still be here, retired rather than removed.
  SELECT count(*) INTO v_retired
  FROM public.portal_terms_versions
  WHERE portal = 'solicitor' AND version = '2026-07-30' AND retired_at IS NOT NULL;
  IF v_retired <> 1 THEN
    RAISE NOTICE 'solicitor terms: no retired 2026-07-30 version present (fresh database?)';
  END IF;

  RAISE NOTICE 'solicitor terms: published % (% chars, hash %)',
    v_current.version, v_current.len, left(v_current.document_hash, 12);
END $$;
