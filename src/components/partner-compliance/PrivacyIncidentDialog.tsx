import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, ShieldAlert } from 'lucide-react';
import { INCIDENT_TYPE_LABELS, type PrivacyIncident } from '@/hooks/usePartnerCompliance';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agreements: { id: string; label: string }[];
  submitting: boolean;
  onSubmit: (data: Partial<PrivacyIncident>) => void;
}

const DATA_CATEGORIES = [
  'Identity details', 'Contact details', 'Financial position', 'Credit information',
  'Employment details', 'Identity documents', 'Property details', 'Banking details',
];

export default function PrivacyIncidentDialog({ open, onOpenChange, agreements, submitting, onSubmit }: Props) {
  const [form, setForm] = useState({
    title: '',
    agreement_id: '__none__',
    incident_type: 'unauthorised_disclosure',
    severity: 'medium',
    reported_by_party: 'principal',
    discovered_at: new Date().toISOString().slice(0, 16),
    description: '',
    affected_individual_count: '0',
    containment_actions: '',
    categories: [] as string[],
  });

  const toggleCategory = (c: string) =>
    setForm((f) => ({
      ...f,
      categories: f.categories.includes(c) ? f.categories.filter((x) => x !== c) : [...f.categories, c],
    }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      title: form.title.trim(),
      agreement_id: form.agreement_id === '__none__' ? null : form.agreement_id,
      incident_type: form.incident_type,
      severity: form.severity as PrivacyIncident['severity'],
      reported_by_party: form.reported_by_party,
      discovered_at: new Date(form.discovered_at).toISOString(),
      description: form.description.trim() || null,
      affected_individual_count: parseInt(form.affected_individual_count, 10) || 0,
      containment_actions: form.containment_actions.trim() || null,
      affected_data_categories: form.categories,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Log Privacy Incident
          </DialogTitle>
          <DialogDescription>
            Clause 10 — notify the other party promptly. The 48-hour notification deadline and the
            30-day assessment deadline are set automatically from the discovery time.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex-1 flex flex-col min-h-0">
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pi-title">Title *</Label>
                <Input
                  id="pi-title" required minLength={3} maxLength={200}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Referral details emailed to the wrong broker"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Related agreement</Label>
                  <Select value={form.agreement_id} onValueChange={(v) => setForm({ ...form, agreement_id: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Not agreement-specific</SelectItem>
                      {agreements.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Incident type</Label>
                  <Select value={form.incident_type} onValueChange={(v) => setForm({ ...form, incident_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(INCIDENT_TYPE_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Severity</Label>
                  <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['low', 'medium', 'high', 'critical'].map((s) => (
                        <SelectItem key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Reported by</Label>
                  <Select value={form.reported_by_party} onValueChange={(v) => setForm({ ...form, reported_by_party: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="principal">Us (principal)</SelectItem>
                      <SelectItem value="partner">Partner</SelectItem>
                      <SelectItem value="client">Client</SelectItem>
                      <SelectItem value="third_party">Third party</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pi-disc">Discovered at *</Label>
                  <Input
                    id="pi-disc" type="datetime-local" required
                    value={form.discovered_at}
                    onChange={(e) => setForm({ ...form, discovered_at: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pi-count">Individuals affected</Label>
                  <Input
                    id="pi-count" type="number" min={0}
                    value={form.affected_individual_count}
                    onChange={(e) => setForm({ ...form, affected_individual_count: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Data categories involved</Label>
                <div className="flex flex-wrap gap-2">
                  {DATA_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleCategory(c)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        form.categories.includes(c)
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/40'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pi-desc">What happened</Label>
                <Textarea
                  id="pi-desc" rows={4} maxLength={4000}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pi-cont">Containment actions taken</Label>
                <Textarea
                  id="pi-cont" rows={3} maxLength={4000}
                  value={form.containment_actions}
                  onChange={(e) => setForm({ ...form, containment_actions: e.target.value })}
                />
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
              Log Incident
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
