-- AML/CTF client-portal consent catalogue (AUSTRAC-referenced).
--
-- Consent was previously a hard-coded three-checkbox list in the client
-- portal bundle, gated only by localStorage. That is not defensible as
-- evidence: the wording could change with a deploy, nothing recorded WHAT
-- the client saw, and the "wall" was bypassable client-side.
--
-- This migration introduces a versioned, server-owned catalogue. Each
-- acceptance in aml.consents can now be tied to the exact document text
-- and statutory basis presented at the time, which is what an AUSTRAC
-- reviewer or an independent evaluation (AML/CTF Act s 84) will ask for.
--
-- Additive only. No existing rows are modified.
--
-- ROLLBACK:
--   ALTER TABLE aml.consents DROP COLUMN IF EXISTS document_id;
--   ALTER TABLE aml.consents DROP COLUMN IF EXISTS document_hash;
--   DROP TABLE IF EXISTS aml.consent_documents;

CREATE TABLE IF NOT EXISTS aml.consent_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  version text NOT NULL,
  -- 'consent'      → the client must actively agree before proceeding.
  -- 'notice'       → disclosure the client must acknowledge having read.
  acknowledgement_type text NOT NULL DEFAULT 'consent'
    CHECK (acknowledgement_type IN ('consent', 'notice')),
  title text NOT NULL,
  summary text NOT NULL,
  body text NOT NULL,
  -- Plain-language statements of the legal basis, shown to the client.
  statutory_basis text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- [{ label, url }] — published AUSTRAC / OAIC material.
  reference_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  effective_from timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

GRANT ALL ON aml.consent_documents TO service_role;
ALTER TABLE aml.consent_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_consent_documents_service_only" ON aml.consent_documents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_aml_consent_documents_current
  ON aml.consent_documents(version, sort_order) WHERE retired_at IS NULL;

-- Bind each acceptance to the exact document revision the client saw.
-- Nullable so historic acceptances keep their existing meaning.
ALTER TABLE aml.consents ADD COLUMN IF NOT EXISTS document_id uuid
  REFERENCES aml.consent_documents(id);
ALTER TABLE aml.consents ADD COLUMN IF NOT EXISTS document_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_aml_consents_case_kind_version
  ON aml.consents(case_id, kind, version);

-- ─────────────────────────────────────────────────────────────────────────
-- Catalogue v2026.1
--
-- Note on scope: these are CUSTOMER-facing disclosures. The AUSTRAC Online
-- terms and conditions are an agreement between AUSTRAC and the reporting
-- entity (us), not between us and the customer — they are surfaced here as
-- a reference link explaining who we report to, never as something the
-- customer is asked to accept on AUSTRAC's behalf.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO aml.consent_documents
  (code, version, acknowledgement_type, title, summary, body, statutory_basis, reference_links, required, sort_order)
VALUES
(
  'privacy_notice', '2026.1', 'consent',
  'Collection notice and privacy consent',
  'How we collect, use, store and disclose your personal information for anti-money laundering purposes.',
  'We are a reporting entity regulated by AUSTRAC (the Australian Transaction Reports and Analysis Centre). '
  'Before we can provide you with a designated service we are required by law to collect and verify personal '
  'information about you, and about any person who owns or controls an entity or trust you are purchasing through.'
  || E'\n\n' ||
  'The information we collect includes your full name, date of birth, residential address, identity document '
  'details, the source of the funds and wealth used in your purchase, and details of the parties to the '
  'transaction. If you do not provide this information we may be unable to act for you.'
  || E'\n\n' ||
  'We use this information only for anti-money laundering and counter-terrorism financing purposes and for '
  'directly related legal, audit and record-keeping purposes. We may disclose it to AUSTRAC, to identity '
  'verification and screening providers acting on our behalf, to our professional advisers, and to law '
  'enforcement or regulators where we are required or authorised by law to do so. Some of our verification and '
  'screening providers may store or process data outside Australia; where that occurs we take reasonable steps '
  'to ensure the recipient handles your information consistently with the Australian Privacy Principles.'
  || E'\n\n' ||
  'You may request access to, or correction of, the personal information we hold about you, and you may complain '
  'to us or to the Office of the Australian Information Commissioner about how we have handled it. Some '
  'information cannot be released to you where doing so would disclose a report made to AUSTRAC.',
  ARRAY[
    'Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth) — customer identification and verification',
    'Privacy Act 1988 (Cth), Australian Privacy Principles 3 and 5 — collection and notification',
    'Privacy Act 1988 (Cth), Australian Privacy Principles 6 and 8 — use, disclosure and cross-border disclosure',
    'Privacy Act 1988 (Cth), Australian Privacy Principles 12 and 13 — access and correction'
  ],
  '[
     {"label": "AUSTRAC privacy policy", "url": "https://www.austrac.gov.au/about-us/privacy-policy"},
     {"label": "Australian Privacy Principles (OAIC)", "url": "https://www.oaic.gov.au/privacy/australian-privacy-principles"}
   ]'::jsonb,
  true, 10
),
(
  'identity_verification', '2026.1', 'consent',
  'Identity verification',
  'Consent to verify your identity electronically or from certified documents.',
  'We must be reasonably satisfied that you are who you say you are before we provide a designated service, and '
  'we must identify and verify any beneficial owner — generally a person who ultimately owns or controls 25% or '
  'more of an entity, or who controls a trust.'
  || E'\n\n' ||
  'You consent to us verifying your identity by electronic means, from reliable and independent sources, or from '
  'original or certified copies of identity documents. Electronic verification may include matching your name, '
  'date of birth and address against information held by a credit reporting body. A credit reporting body may '
  'prepare and provide us with an assessment of whether that information matches; this is an identity check only '
  'and is not a credit application, and it does not affect your credit rating. If you prefer, you may ask us to '
  'verify your identity from documents instead.'
  || E'\n\n' ||
  'We may also carry out sanctions, politically exposed person and adverse media screening on you and on the '
  'other parties to your transaction. If we cannot verify your identity to the required standard we may be '
  'unable to proceed.',
  ARRAY[
    'Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth) — applicable customer identification procedure',
    'Anti-Money Laundering and Counter-Terrorism Financing Rules — customer identification and beneficial ownership',
    'Privacy Act 1988 (Cth), Part IIIA — identity verification using credit reporting information, with your consent',
    'Autonomous Sanctions Act 2011 (Cth) and Charter of the United Nations Act 1945 (Cth) — sanctions screening'
  ],
  '[
     {"label": "AUSTRAC — customer identification and verification", "url": "https://www.austrac.gov.au/business/core-guidance/customer-identification-and-verification"},
     {"label": "AUSTRAC — beneficial ownership", "url": "https://www.austrac.gov.au/business/core-guidance/customer-identification-and-verification/beneficial-ownership"}
   ]'::jsonb,
  true, 20
),
(
  'aml_ctf_program', '2026.1', 'consent',
  'Ongoing customer due diligence',
  'Why we may come back to you for more information while we act for you.',
  'Our AML/CTF program requires us to keep customer information current and to monitor the business relationship '
  'for the life of that relationship, not only at the start.'
  || E'\n\n' ||
  'You acknowledge that we may ask you for further information or documents at any time — for example if your '
  'circumstances change, if the structure or funding of your purchase changes, if a transaction does not match '
  'what we would expect, or if information from screening requires clarification. You agree to provide that '
  'information within a reasonable time.'
  || E'\n\n' ||
  'Where a matter is assessed as higher risk we are required to apply enhanced due diligence, which may include '
  'additional verification of your source of funds and source of wealth, and senior management approval before '
  'we continue.',
  ARRAY[
    'Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth) — ongoing customer due diligence',
    'Anti-Money Laundering and Counter-Terrorism Financing Rules — enhanced customer due diligence and transaction monitoring'
  ],
  '[
     {"label": "AUSTRAC — ongoing customer due diligence", "url": "https://www.austrac.gov.au/business/core-guidance/ongoing-customer-due-diligence"}
   ]'::jsonb,
  true, 30
),
(
  'regulatory_reporting', '2026.1', 'notice',
  'Reporting to AUSTRAC',
  'What we are required to report, and what we are not permitted to tell you.',
  'As a reporting entity we must give AUSTRAC certain reports. These include reports of transactions at or above '
  'the reporting threshold, reports of international funds transfer instructions, and suspicious matter reports.'
  || E'\n\n' ||
  'The law prohibits us from telling you, or anyone else, that a suspicious matter report has been formed, made '
  'or is being considered, or from disclosing related information, except in the limited circumstances the law '
  'allows. If we are unable to answer a question about your matter, that limit may be the reason. This is a legal '
  'obligation on us and is not a comment on you.'
  || E'\n\n' ||
  'We are also required to compare parties to your transaction against sanctions lists, and we may be required to '
  'decline or delay a service as a result.',
  ARRAY[
    'Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth) — suspicious matter reports',
    'Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth) — threshold transaction reports and international funds transfer instructions',
    'Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth) — offence of tipping off'
  ],
  '[
     {"label": "AUSTRAC — reporting obligations", "url": "https://www.austrac.gov.au/business/how-comply-and-report-guidance-and-resources/reporting"},
     {"label": "AUSTRAC — suspicious matter reports", "url": "https://www.austrac.gov.au/business/how-comply-and-report-guidance-and-resources/reporting/suspicious-matter-reports-smr"},
     {"label": "AUSTRAC Online (how we lodge reports)", "url": "https://www.austrac.gov.au/business/austrac-online"}
   ]'::jsonb,
  true, 40
),
(
  'record_keeping', '2026.1', 'notice',
  'Record keeping and retention',
  'How long we keep the information and documents you give us.',
  'We are required to keep records of the customer identification we carry out, the documents you provide, and '
  'the transactions we are involved in. Those records must be retained for at least seven years.'
  || E'\n\n' ||
  'The retention period is measured from the relevant trigger event — for identification records, from the end of '
  'our business relationship with you; for transaction records, from the date of the transaction — not from the '
  'date you uploaded a document. Records are disposed of only after that period has run and only where no legal '
  'hold, investigation or reporting obligation still applies.',
  ARRAY[
    'Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth) — record-keeping obligations (seven years)',
    'Privacy Act 1988 (Cth), Australian Privacy Principle 11 — security and destruction of personal information'
  ],
  '[
     {"label": "AUSTRAC — record keeping", "url": "https://www.austrac.gov.au/business/core-guidance/record-keeping"}
   ]'::jsonb,
  true, 50
)
ON CONFLICT (code, version) DO NOTHING;
