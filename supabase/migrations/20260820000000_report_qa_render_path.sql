-- The Report Q&A export's render path.
--
-- One table: a record of what was produced, from which conversation, under whose
-- brand, and how much of the conversation it actually carried.
--
-- The conversation is deliberately **not** copied here. It is already rows in
-- `report_qa_conversations` and `report_qa_messages`, and this document is a
-- rendering of them, so a snapshot in the ledger would be a second answer to
-- "what was said" — the failure mode this programme removes rather than adds.
-- The same reasoning `20260815000000_cash_flow_render_path.sql` gives for the
-- projection and `20260819000000_client_details_render_path.sql` for the client.

CREATE TABLE IF NOT EXISTS public.report_qa_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE: the document is *of* the conversation, so a deleted conversation
  -- has no render worth keeping.
  conversation_id uuid NOT NULL
    REFERENCES public.report_qa_conversations(id) ON DELETE CASCADE,

  -- Set only for the single-answer subject. SET NULL rather than CASCADE: an
  -- answer can be deleted from a conversation that still exists, and the record
  -- that a PDF of it was sent to somebody outlives the message itself.
  message_id uuid REFERENCES public.report_qa_messages(id) ON DELETE SET NULL,

  -- Which of the three documents this was.
  --
  -- The whole point of the format is that these are one renderer rather than
  -- four implementations, so which one was asked for has to be a column: "the
  -- transcript is failing but the structured report is fine" is a question this
  -- answers and nothing else does.
  subject text NOT NULL CHECK (subject IN ('structured', 'answer', 'transcript')),

  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),

  -- What was produced.
  file_name text NOT NULL DEFAULT '',
  -- The private bucket the legacy server path already writes to, so both paths'
  -- artefacts sit together under one access rule.
  storage_bucket text NOT NULL DEFAULT 'qa_exports',
  storage_path text,
  bytes integer,
  page_count integer,

  -- How much of the conversation the document carried.
  --
  -- Two numbers, not one, because they answer different questions.
  -- `turn_count` is how long the conversation was; `turns_shown` is how much of
  -- it fitted. Measured before the work: conversations run from 0 to 35
  -- exchanges, 232 of 244 are eight or fewer, and the four largest estimate at
  -- over a hundred and fifty printed pages.
  turn_count integer NOT NULL DEFAULT 0,
  turns_shown integer NOT NULL DEFAULT 0,

  -- True when the document said on its own pages that it was not the whole
  -- conversation.
  --
  -- "How often are we sending someone a partial conversation?" is the question
  -- the cap creates, and it deserves to be one query rather than a scan of two
  -- integer columns. Indexed below for exactly that.
  truncated boolean NOT NULL DEFAULT false,

  -- True when this render called a model rather than reading a stored write-up.
  --
  -- This is the only route in the programme that can spend tokens. The call is
  -- metered into `api_usage_log`, and this column is how a spend there is traced
  -- back to the document that caused it.
  generated_summary boolean NOT NULL DEFAULT false,

  -- Which sections the document turned out to have.
  --
  -- Unlike every other format's, these are *discovered* rather than declared —
  -- the sections are the headings the model wrote. So two renders of two
  -- conversations are legitimately different documents with different contents
  -- pages, and this is how anyone checks what a given file actually contained
  -- without re-rendering it.
  sections_included text[] NOT NULL DEFAULT '{}',

  -- The brand it was issued under. RESTRICT for the same reason the snapshot
  -- table uses it: a pinned brand that is still referenced cannot be removed.
  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,

  -- What the brand snapshot was missing, from `auditSnapshot()`. Advisory:
  -- rendering does not stop for a missing ABN, but a support question about a
  -- document with no ABN on it has an answer here.
  brand_gaps text[] NOT NULL DEFAULT '{}',

  duration_ms integer,
  error text,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.report_qa_renders IS
  'One row per Report Q&A render: what was produced, from which conversation, which of the three subjects, how much of the conversation it carried, and under which brand snapshot. Written by render-report-qa-pdf. The conversation is not copied here — see the migration header for why.';

CREATE INDEX IF NOT EXISTS report_qa_renders_conversation_idx
  ON public.report_qa_renders (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS report_qa_renders_brand_idx
  ON public.report_qa_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
-- Support queries start from "which renders failed today".
CREATE INDEX IF NOT EXISTS report_qa_renders_failed_idx
  ON public.report_qa_renders (created_at DESC)
  WHERE status = 'failed';
-- "How many of the documents we send are only part of the conversation?" — the
-- question the transcript cap creates, and it should be one query.
CREATE INDEX IF NOT EXISTS report_qa_renders_truncated_idx
  ON public.report_qa_renders (created_at DESC)
  WHERE truncated;
-- "What did the model calls cost, and which documents caused them?" — the
-- question the only token-spending route in the programme creates.
CREATE INDEX IF NOT EXISTS report_qa_renders_generated_idx
  ON public.report_qa_renders (created_at DESC)
  WHERE generated_summary;
-- Which subject is being used, and which is failing.
CREATE INDEX IF NOT EXISTS report_qa_renders_subject_idx
  ON public.report_qa_renders (subject, created_at DESC);

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- A render row points at a file containing an advisor's questions and a model's
-- answers about named properties, and often about a named client's position.
-- The route that writes it gates on the `report_qa / can_view` module permission
-- *and* on `resolveReportQaAccess`; the read policy below is the narrowest rule
-- available, because a row here is evidence and superadmins are who audit it.

ALTER TABLE public.report_qa_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_qa_renders_select
  ON public.report_qa_renders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.report_qa_renders FROM anon, authenticated;
GRANT SELECT ON public.report_qa_renders TO authenticated;
GRANT ALL ON public.report_qa_renders TO service_role;
