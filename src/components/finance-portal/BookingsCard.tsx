import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CalendarClock, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

const FN = 'finance-portal-batch6';

type Booking = {
  id: string; start_at: string; end_at: string; status: string;
  meeting_type: string; topic: string | null; contact_name: string | null; contact_email: string | null;
  booked_by: string; client_id: string | null;
};

export function BookingsCard() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['fp-bookings'],
    queryFn: async () => {
      const res = await invokeFinanceFunction(FN, { operation: 'bookings_list' });
      if (res.error) throw new Error(res.error);
      return res.data?.bookings as Booking[];
    },
  });

  const cancel = async (id: string) => {
    if (!confirm('Cancel this booking?')) return;
    const res = await invokeFinanceFunction(FN, { operation: 'bookings_cancel', booking_id: id });
    if (res.error) return toast.error(res.error);
    toast.success('Cancelled');
    qc.invalidateQueries({ queryKey: ['fp-bookings'] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" />Upcoming bookings</CardTitle>
        <CardDescription className="text-xs">Self-service client bookings + your manual entries.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> :
          !data?.length ? <p className="text-xs text-muted-foreground">No upcoming bookings.</p> :
          data.map(b => (
            <div key={b.id} className="flex items-center justify-between p-2 rounded border border-border/60">
              <div className="min-w-0">
                <p className="text-sm font-medium">{new Date(b.start_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                <p className="text-xs text-muted-foreground truncate">{b.topic || 'Meeting'} · {b.contact_name || b.contact_email || 'Client'}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs capitalize">{b.meeting_type}</Badge>
                <Badge variant={b.status === 'confirmed' ? 'default' : 'secondary'} className="text-xs capitalize">{b.status}</Badge>
                {b.status === 'confirmed' && <Button size="icon" variant="ghost" onClick={() => cancel(b.id)}><X className="h-3.5 w-3.5" /></Button>}
              </div>
            </div>
          ))
        }
      </CardContent>
    </Card>
  );
}
