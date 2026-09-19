
-- Create a trigger function that inserts a notification for every completed call
-- This mirrors the email notification pattern: server-side trigger → notifications table → realtime to client
CREATE OR REPLACE FUNCTION public.notify_call_completed()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  caller_name text;
  direction text;
  msg text;
BEGIN
  -- Only fire when call_status transitions to 'ended'
  -- For INSERTs: fire if already ended
  -- For UPDATEs: fire only if status changed to ended
  IF TG_OP = 'UPDATE' AND OLD.call_status IS NOT DISTINCT FROM NEW.call_status THEN
    RETURN NEW;
  END IF;
  
  IF NEW.call_status != 'ended' THEN
    RETURN NEW;
  END IF;

  caller_name := COALESCE(NEW.customer_name, NEW.phone_number, 'Unknown caller');
  
  IF NEW.call_direction = 'inbound' THEN
    direction := 'Inbound';
  ELSE
    direction := 'Outbound';
  END IF;

  msg := direction || ' call with ' || caller_name;

  INSERT INTO public.notifications (type, title, message, entity_id, read)
  VALUES (
    'call_completed',
    direction || ' Call',
    msg,
    NEW.id::text,
    false
  );
  
  RETURN NEW;
END;
$function$;

-- Attach the trigger to vapi_call_logs
DROP TRIGGER IF EXISTS trigger_notify_call_completed ON public.vapi_call_logs;
CREATE TRIGGER trigger_notify_call_completed
  AFTER INSERT OR UPDATE ON public.vapi_call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_call_completed();
