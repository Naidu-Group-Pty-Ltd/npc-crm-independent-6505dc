-- Add game plan notification types to the constraint
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
CHECK (type = ANY (ARRAY[
  'report_generated', 'report_failed', 'info', 'call_completed',
  'report_generation_completed', 'report_generation_failed',
  'portal_report_requested', 'agreement_generated',
  'new_ghl_contact', 'new_marketing_lead', 'missed_call',
  'client_reminder_overdue', 'client_reminder_due', 'client_reminder_upcoming',
  'report_request', 'email_received', 'conversation_shared',
  'game_plan_created', 'game_plan_updated', 'game_plan_milestone_completed'
]));

-- Trigger: notify when a game plan is created
CREATE OR REPLACE FUNCTION public.notify_game_plan_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.notifications (type, title, message, entity_id, read)
  VALUES (
    'game_plan_created',
    'New Game Plan',
    'Game plan "' || COALESCE(NEW.name, 'Untitled') || '" has been created',
    NEW.id::text,
    false
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_game_plan_created ON public.game_plans;
CREATE TRIGGER on_game_plan_created
  AFTER INSERT ON public.game_plans
  FOR EACH ROW EXECUTE FUNCTION public.notify_game_plan_created();

-- Trigger: notify when a game plan status changes
CREATE OR REPLACE FUNCTION public.notify_game_plan_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.notifications (type, title, message, entity_id, read)
    VALUES (
      'game_plan_updated',
      'Game Plan Updated',
      '"' || COALESCE(NEW.name, 'Untitled') || '" status changed to ' || NEW.status,
      NEW.id::text,
      false
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_game_plan_status_change ON public.game_plans;
CREATE TRIGGER on_game_plan_status_change
  AFTER UPDATE ON public.game_plans
  FOR EACH ROW EXECUTE FUNCTION public.notify_game_plan_status_change();

-- Trigger: notify when a milestone is completed
CREATE OR REPLACE FUNCTION public.notify_game_plan_milestone_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  plan_id_val uuid;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    SELECT gpp.plan_id INTO plan_id_val
    FROM public.game_plan_phases gpp
    WHERE gpp.id = NEW.phase_id;

    INSERT INTO public.notifications (type, title, message, entity_id, read)
    VALUES (
      'game_plan_milestone_completed',
      'Milestone Completed',
      '"' || COALESCE(NEW.title, 'Untitled') || '" has been completed',
      COALESCE(plan_id_val::text, NEW.phase_id::text),
      false
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_game_plan_milestone_completed ON public.game_plan_milestones;
CREATE TRIGGER on_game_plan_milestone_completed
  AFTER UPDATE ON public.game_plan_milestones
  FOR EACH ROW EXECUTE FUNCTION public.notify_game_plan_milestone_completed();