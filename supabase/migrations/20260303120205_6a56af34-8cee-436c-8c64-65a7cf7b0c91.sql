CREATE TABLE IF NOT EXISTS public.report_qa_conversation_shares (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES public.report_qa_conversations(id) ON DELETE CASCADE,
    shared_by uuid NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
    shared_with uuid NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
    permission text NOT NULL DEFAULT 'view',
    handoff_note text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(conversation_id, shared_with)
);

ALTER TABLE public.report_qa_conversation_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on report_qa_conversation_shares"
    ON public.report_qa_conversation_shares
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);