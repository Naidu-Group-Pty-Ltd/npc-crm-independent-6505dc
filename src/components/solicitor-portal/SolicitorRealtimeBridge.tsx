import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { solicitorKeys } from '@/lib/solicitorQueries';

/** Controlled invalidation stream; RLS remains the server-side visibility boundary. */
export function SolicitorRealtimeBridge() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase.channel('solicitor-portal-events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitor_portal_notifications' }, () => void queryClient.invalidateQueries({ queryKey: solicitorKeys.notifications() }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => void queryClient.invalidateQueries({ queryKey: solicitorKeys.conversations() }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_tasks' }, () => void queryClient.invalidateQueries({ queryKey: solicitorKeys.milestonesRoot() }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitor_matter_access' }, () => { void queryClient.invalidateQueries({ queryKey: solicitorKeys.mattersRoot() }); void queryClient.invalidateQueries({ queryKey: solicitorKeys.session() }); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);
  return null;
}
