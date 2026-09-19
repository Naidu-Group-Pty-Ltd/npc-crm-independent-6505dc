/**
 * Self-service booking: client picks a free slot from broker availability.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CalendarPlus, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { portalSessionBodyFields, portalSessionHeaders } from '@/lib/portalSession';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


type Slot = { start_at: string; end_at: string };
type Booking = { id: string; start_at: string; end_at: string; status: string; topic: string | null };

async function call(operation: string, body: any = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/client-portal-batch6`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      ...portalSessionHeaders(),
    },
    // NOT `credentials: 'include'`: this endpoint answers with a wildcard
    // `Access-Control-Allow-Origin`, and a wildcard origin is invalid for a
    // credentialed request — the browser would block the response outright.
    // The session therefore rides the `x-portal-session-token` header, whose
    // in-memory token `client-portal-verify` repopulates on every load.
    body: JSON.stringify({ operation, ...body, ...portalSessionBodyFields() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

export function ClientBookingCard({ financeUserId }: { financeUserId: string | null }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<Slot | null>(null);
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadBookings = async () => {
    try { const j = await call('bookings_list'); setBookings(j.bookings || []); } catch {}
  };

  const openDialog = async () => {
    if (!financeUserId) return toast.error('No finance partner assigned yet');
    setOpen(true); setLoading(true);
    try {
      const j = await call('availability_slots', { finance_user_id: financeUserId, days: 14 });
      setSlots(j.slots || []);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadBookings(); }, []);

  const book = async () => {
    if (!picking || !financeUserId) return;
    setSubmitting(true);
    try {
      await call('booking_create', {
        finance_user_id: financeUserId,
        start_at: picking.start_at, end_at: picking.end_at,
        topic: topic || null, notes: notes || null,
      });
      toast.success('Booking confirmed');
      setOpen(false); setPicking(null); setTopic(''); setNotes('');
      loadBookings();
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const cancel = async (id: string) => {
    if (!confirm('Cancel this booking?')) return;
    try { await call('booking_cancel', { booking_id: id }); loadBookings(); }
    catch (e: any) { toast.error(e.message); }
  };

  // Group slots by date
  const grouped: Record<string, Slot[]> = {};
  for (const s of slots) {
    const k = new Date(s.start_at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    (grouped[k] = grouped[k] || []).push(s);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2"><CalendarPlus className="h-4 w-4 text-primary" />Book a call</CardTitle>
        <Button size="sm" onClick={openDialog} disabled={!financeUserId}><CalendarPlus className="h-3.5 w-3.5 mr-1" />Find a time</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {!bookings.length ? <p className="text-xs text-muted-foreground">No upcoming bookings.</p> :
          bookings.filter(b => b.status === 'confirmed').map(b => (
            <div key={b.id} className="flex items-center justify-between p-2 rounded border border-border/60">
              <div>
                <p className="text-sm font-medium">{new Date(b.start_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                {b.topic && <p className="text-xs text-muted-foreground">{b.topic}</p>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => cancel(b.id)}>Cancel</Button>
            </div>
          ))
        }
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{picking ? 'Confirm booking' : 'Pick a time'}</DialogTitle></DialogHeader>
          {loading ? <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div> :
            picking ? (
              <div className="space-y-3">
                <div className="rounded-md border border-border p-3 flex items-center gap-2 bg-muted/30">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">{new Date(picking.start_at).toLocaleString('en-AU', { dateStyle: 'full', timeStyle: 'short' })}</span>
                </div>
                <div><Label>What's the call about?</Label><Input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Loan strategy review" /></div>
                <div><Label>Notes (optional)</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} /></div>
              </div>
            ) : !slots.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No available slots in the next 2 weeks. Please contact your broker directly.</p>
            ) : (
              <div className="max-h-[400px] overflow-auto space-y-3">
                {Object.entries(grouped).map(([day, daySlots]) => (
                  <div key={day}>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">{day}</p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                      {daySlots.map(s => (
                        <Button key={s.start_at} variant="outline" size="sm" onClick={() => setPicking(s)}>
                          {new Date(s.start_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          }
          <DialogFooter>
            {picking && <Button variant="outline" onClick={() => setPicking(null)}>Back</Button>}
            <Button variant="outline" onClick={() => { setOpen(false); setPicking(null); }}>Close</Button>
            {picking && <Button onClick={book} disabled={submitting}>{submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Confirm</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
