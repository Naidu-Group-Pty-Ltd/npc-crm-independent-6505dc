CREATE TYPE public.pf_client_task_type AS ENUM (
  'document_upload',
  'lender_condition_action',
  'signature_request',
  'information_request',
  'decision_required',
  'payment_required',
  'other'
);

CREATE TYPE public.pf_client_task_status AS ENUM (
  'pending',
  'in_progress',
  'completed',
  'dismissed',
  'expired'
);

CREATE TABLE public.purchase_file_client_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  task_type public.pf_client_task_type NOT NULL,
  status public.pf_client_task_status NOT NULL DEFAULT 'pending',
  title text NOT NULL,
  description text,
  due_date date,
  related_document_instance_id uuid REFERENCES public.document_requirement_instances(id) ON DELETE SET NULL,
  related_condition_id uuid REFERENCES public.purchase_file_conditions(id) ON DELETE SET NULL,
  related_decision_id uuid REFERENCES public.purchase_file_finance_decisions(id) ON DELETE SET NULL,
  created_by_finance_user_id uuid REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  client_response_text text,
  client_response_at timestamptz,
  completed_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.purchase_file_client_tasks TO service_role;

ALTER TABLE public.purchase_file_client_tasks ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_pfct_purchase_file ON public.purchase_file_client_tasks(purchase_file_id);
CREATE INDEX idx_pfct_client_status ON public.purchase_file_client_tasks(client_id, status);
CREATE INDEX idx_pfct_due_date ON public.purchase_file_client_tasks(due_date) WHERE due_date IS NOT NULL AND status IN ('pending','in_progress');

CREATE TRIGGER update_pfct_updated_at
BEFORE UPDATE ON public.purchase_file_client_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_file_client_tasks;