ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS assigned_team_user_id uuid REFERENCES public.custom_users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_clients_assigned_team_user_id ON public.clients(assigned_team_user_id);
COMMENT ON COLUMN public.clients.assigned_team_user_id IS 'Internal team member assigned to manage this client (custom_users.id).';