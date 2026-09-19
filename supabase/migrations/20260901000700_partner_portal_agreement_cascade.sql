-- Cascade the Portal Access, Confidentiality, Privacy and AML/CTF Compliance
-- Passport Agreement to the Builder/Developer and Finance portals.
--
-- The Solicitor Portal has been executing this agreement since 2026-08-07. The
-- Builder Portal was still on a six-clause "Terms of Use" and the Finance
-- Portal on a string compiled into the bundle, so the three portals were asking
-- partner organisations to agree to three different things. The document itself
-- says who it binds: "the Partner Organisation" — a solicitor's practice, a
-- builder, a finance partner alike. One document, presented the same way, in
-- all three.
--
-- ONE ROW PER PORTAL, not one row shared. Each portal keeps its own version,
-- its own document hash and its own acceptance history, because acceptance is
-- an act by a named person in a named portal and the audit trail has to say
-- which. The text is identical and generated from the solicitor version rather
-- than retyped, so the three cannot drift apart in wording.
--
-- The Finance Portal has never had a versioned acceptance at all: it flipped a
-- boolean on the user row. That boolean stays (it is what the existing screens
-- read), but it is no longer the record — an acceptance row against a version
-- is. So the ownership model gains a third owner column, with the same
-- exactly-one-owner and portal-agrees-with-owner guarantees the other two have.
--
-- ORDERING. Owner column and CHECKs first, then the versions. A published
-- 'finance' version with no way to store a finance acceptance would gate the
-- portal on an agreement nobody could accept.

-- ===========================================================================
-- 1. Widen the portal discriminator to the Finance Portal
-- ===========================================================================
ALTER TABLE public.portal_terms_versions
  DROP CONSTRAINT IF EXISTS portal_terms_versions_portal_check;
ALTER TABLE public.portal_terms_versions
  ADD CONSTRAINT portal_terms_versions_portal_check
  CHECK (portal IN ('solicitor','builder','finance'));

ALTER TABLE public.portal_terms_acceptances
  DROP CONSTRAINT IF EXISTS portal_terms_acceptances_portal_check;
ALTER TABLE public.portal_terms_acceptances
  ADD CONSTRAINT portal_terms_acceptances_portal_check
  CHECK (portal IN ('solicitor','builder','finance'));

-- The partial unique index on (portal) WHERE retired_at IS NULL already yields
-- one current version per portal, which is exactly right for a third portal.

-- ===========================================================================
-- 2. The Finance Portal owner column
--
-- A real foreign key, not a generic user id: nothing else would stop an
-- acceptance naming a user that does not exist, or a finance id being stored
-- under a builder portal marker.
-- ===========================================================================
ALTER TABLE public.portal_terms_acceptances
  ADD COLUMN IF NOT EXISTS finance_user_id uuid
    REFERENCES public.finance_portal_users(id) ON DELETE CASCADE;

-- Exactly one owner, now three-way.
ALTER TABLE public.portal_terms_acceptances
  DROP CONSTRAINT IF EXISTS portal_terms_acceptances_single_owner;
ALTER TABLE public.portal_terms_acceptances
  ADD CONSTRAINT portal_terms_acceptances_single_owner
  CHECK (num_nonnulls(solicitor_user_id, builder_user_id, finance_user_id) = 1) NOT VALID;
ALTER TABLE public.portal_terms_acceptances
  VALIDATE CONSTRAINT portal_terms_acceptances_single_owner;

-- The owner column must agree with the portal discriminator. This is what stops
-- one portal's user accepting another portal's terms, and what makes it a
-- database guarantee rather than an application convention.
ALTER TABLE public.portal_terms_acceptances
  DROP CONSTRAINT IF EXISTS portal_terms_acceptances_portal_owner_agree;
ALTER TABLE public.portal_terms_acceptances
  ADD CONSTRAINT portal_terms_acceptances_portal_owner_agree
  CHECK (
    (portal = 'solicitor' AND solicitor_user_id IS NOT NULL AND builder_user_id IS NULL AND finance_user_id IS NULL)
    OR
    (portal = 'builder'   AND builder_user_id   IS NOT NULL AND solicitor_user_id IS NULL AND finance_user_id IS NULL)
    OR
    (portal = 'finance'   AND finance_user_id   IS NOT NULL AND solicitor_user_id IS NULL AND builder_user_id IS NULL)
  ) NOT VALID;
ALTER TABLE public.portal_terms_acceptances
  VALIDATE CONSTRAINT portal_terms_acceptances_portal_owner_agree;

-- One acceptance per person per version, the same shape the other two portals
-- have. The edge function reads before inserting because PostgREST cannot
-- target a partial index with on_conflict.
CREATE UNIQUE INDEX IF NOT EXISTS portal_terms_acceptances_finance_key
  ON public.portal_terms_acceptances(terms_version_id, finance_user_id)
  WHERE finance_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS portal_terms_acceptances_finance_user_idx
  ON public.portal_terms_acceptances(finance_user_id)
  WHERE finance_user_id IS NOT NULL;

COMMENT ON COLUMN public.portal_terms_acceptances.finance_user_id IS
  'Finance Portal owner of this acceptance. Exactly one of solicitor_user_id, builder_user_id and finance_user_id is populated, enforced by portal_terms_acceptances_single_owner, and it must agree with the portal discriminator.';

-- ===========================================================================
-- 3. The Builder acceptance RPC learns the acknowledgments
--
-- Adding an OUT/IN parameter changes the signature, so this is a DROP and
-- CREATE rather than a REPLACE. The default keeps the parameter optional for
-- any caller that has not shipped yet; the edge function always sends it, and
-- the acknowledgment gate lives there.
-- ===========================================================================
DROP FUNCTION IF EXISTS public.builder_accept_current_terms(uuid, uuid, text, text);

CREATE FUNCTION public.builder_accept_current_terms(
  _builder_user_id uuid,
  _session_id uuid,
  _ip_hash text DEFAULT NULL,
  _user_agent_hash text DEFAULT NULL,
  _acknowledgements jsonb DEFAULT NULL)
RETURNS TABLE (terms_version_id uuid, version text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_terms record;
BEGIN
  -- Session ownership. Without it the function trusts whatever pair of ids it
  -- is handed, so a caller holding one valid session could record an acceptance
  -- against another user, or a revoked session could still write one.
  IF NOT EXISTS (
    SELECT 1 FROM public.builder_portal_sessions
    WHERE id = _session_id AND builder_user_id = _builder_user_id AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_SESSION_NOT_FOUND';
  END IF;

  -- Aliased deliberately: this function's OUT column is also called `version`,
  -- so selecting the column under its own name makes the reference ambiguous
  -- and the function fails at runtime for every caller.
  SELECT ptv.id AS terms_id, ptv.version AS terms_version INTO v_terms
  FROM public.portal_terms_versions ptv
  WHERE ptv.portal = 'builder' AND ptv.retired_at IS NULL AND ptv.effective_at <= now()
  ORDER BY ptv.effective_at DESC LIMIT 1;

  IF v_terms.terms_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_TERMS_UNAVAILABLE';
  END IF;

  -- Bare `ON CONFLICT DO NOTHING` rather than a column inference list: this
  -- function's OUT column is also called `terms_version_id`, and an inference
  -- list is an expression context where plpgsql resolves that name to the OUT
  -- variable, making the reference ambiguous and failing at runtime.
  INSERT INTO public.portal_terms_acceptances(
    terms_version_id, portal, builder_user_id, acknowledgements, ip_hash, user_agent_hash)
  VALUES (v_terms.terms_id, 'builder', _builder_user_id, _acknowledgements, _ip_hash, _user_agent_hash)
  ON CONFLICT DO NOTHING;

  UPDATE public.builder_portal_users
  SET has_accepted_current_terms = true, terms_accepted_at = now()
  WHERE id = _builder_user_id;

  -- The Builder Portal's own activity log entry, unchanged except that it now
  -- carries which acknowledgments were asserted.
  PERFORM public.builder_log_activity(
    NULL, 'builder_user', 'builder_terms_accepted',
    'portal_user', _builder_user_id, NULL, _builder_user_id,
    NULL, jsonb_build_object(
      'terms_version_id', v_terms.terms_id,
      'version', v_terms.terms_version,
      'acknowledgements', COALESCE(_acknowledgements, '[]'::jsonb)),
    NULL, jsonb_build_object('session_id', _session_id));

  terms_version_id := v_terms.terms_id;
  version := v_terms.terms_version;
  RETURN NEXT;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.builder_accept_current_terms(uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_accept_current_terms(uuid, uuid, text, text, jsonb)
  TO service_role;

-- ===========================================================================
-- 4. Publish the agreement for both portals
--
-- The text below is the current solicitor version (2026-08-07), generated from
-- that migration rather than retyped. Retire whatever each portal currently
-- has: section 16 requires a material change to be accepted afresh, and for
-- these two portals every clause is a change.
-- ===========================================================================
UPDATE public.portal_terms_versions
   SET retired_at = now()
 WHERE portal IN ('builder','finance')
   AND retired_at IS NULL
   AND version <> '2026-08-07';

INSERT INTO public.portal_terms_versions (portal, version, title, content_markdown, effective_at)
SELECT p.portal, '2026-08-07',
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
$md$,
  now()
FROM (VALUES ('builder'), ('finance')) AS p(portal)
ON CONFLICT (portal, version) DO UPDATE
  SET retired_at = NULL
  WHERE public.portal_terms_versions.content_markdown = EXCLUDED.content_markdown;

-- ===========================================================================
-- 5. Post-migration assertions
-- ===========================================================================
DO $$
DECLARE
  v_portal text;
  v_current record;
  v_count bigint;
  v_solicitor_text text;
BEGIN
  SELECT content_markdown INTO v_solicitor_text
  FROM public.portal_terms_versions
  WHERE portal = 'solicitor' AND retired_at IS NULL;

  IF v_solicitor_text IS NULL THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: no current solicitor agreement to cascade from';
  END IF;

  FOREACH v_portal IN ARRAY ARRAY['solicitor','builder','finance'] LOOP
    SELECT count(*) INTO v_count
    FROM public.portal_terms_versions
    WHERE portal = v_portal AND retired_at IS NULL;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'POST-MIGRATION FAILURE: % has % current terms versions, expected 1', v_portal, v_count;
    END IF;

    SELECT version, title, document_hash, content_markdown, length(content_markdown) AS len
      INTO v_current
    FROM public.portal_terms_versions
    WHERE portal = v_portal AND retired_at IS NULL;

    IF v_current.document_hash IS NULL OR length(v_current.document_hash) <> 64 THEN
      RAISE EXCEPTION 'POST-MIGRATION FAILURE: % has no usable document hash', v_portal;
    END IF;

    -- The whole point of the cascade: the same document, not a similar one.
    IF v_current.content_markdown IS DISTINCT FROM v_solicitor_text THEN
      RAISE EXCEPTION 'POST-MIGRATION FAILURE: the % agreement differs from the solicitor agreement', v_portal;
    END IF;
    IF v_current.content_markdown LIKE '%Independent AML/CTF responsibility%' THEN
      RAISE EXCEPTION 'POST-MIGRATION FAILURE: the withdrawn fifth acknowledgment is in the % agreement', v_portal;
    END IF;
    IF v_current.content_markdown NOT LIKE '%## 9. Partner Organisation responsibilities%' THEN
      RAISE EXCEPTION 'POST-MIGRATION FAILURE: the % agreement is missing section 9', v_portal;
    END IF;
  END LOOP;

  -- A finance acceptance must be storable, or the portal is gated on an
  -- agreement nobody can accept.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'portal_terms_acceptances'
      AND column_name = 'finance_user_id'
  ) THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: portal_terms_acceptances has no finance owner column';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
      AND indexname = 'portal_terms_acceptances_finance_key'
  ) THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: finance uniqueness index missing';
  END IF;

  RAISE NOTICE 'partner agreement cascade: solicitor, builder and finance all on one document';
END $$;
