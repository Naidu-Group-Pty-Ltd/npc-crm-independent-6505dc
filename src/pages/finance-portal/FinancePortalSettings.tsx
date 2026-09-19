import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Settings, Bell, Palette, Loader2, Save, Upload, Clock, CalendarClock, Smartphone } from 'lucide-react';
import { AvailabilityCard } from '@/components/finance-portal/AvailabilityCard';
import { BookingsCard } from '@/components/finance-portal/BookingsCard';
import { UiPreferencesCard } from '@/components/finance-portal/UiPreferencesCard';
import { toast } from 'sonner';

const EVENT_TYPES: { key: string; label: string; description: string }[] = [
  { key: 'pf_action_required', label: 'Action required on a file', description: 'You have a task to complete on a deal room.' },
  { key: 'pf_sla_breaching', label: 'SLA about to breach', description: 'Finance clause / valuation expiring inside 24h.' },
  { key: 'pf_unconditional_approval', label: 'Unconditional approval reached', description: 'A file just hit unconditional.' },
  { key: 'pf_settlement_imminent', label: 'Settlement T-7 / T-2', description: 'Settlement countdown reminders.' },
  { key: 'doc_request_overdue', label: 'Document request overdue', description: 'Client is sitting on an outstanding request.' },
  { key: 'message_received', label: 'New message from client / NPC', description: 'Any new portal/shared message.' },
  { key: 'commission_milestone', label: 'Commission milestone reached', description: 'Build payment or settlement commission triggered.' },
  { key: 'clawback_warning', label: 'Clawback expiry approaching', description: 'Active clawback exposure within 60 days.' },
];

const CHANNELS = [
  { key: 'in_app', label: 'In-app' },
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
  { key: 'push', label: 'Push' },
];

export default function FinancePortalSettings() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [prefs, setPrefs] = useState<Record<string, any>>({});
  const [branding, setBranding] = useState<any>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingPref, setSavingPref] = useState<string | null>(null);
  const [savingBranding, setSavingBranding] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Branding fields
  const [companyName, setCompanyName] = useState('');
  const [tagline, setTagline] = useState('');
  const [accent, setAccent] = useState('');

  // Global quiet hours
  const [quietStart, setQuietStart] = useState('21:00');
  const [quietEnd, setQuietEnd] = useState('07:00');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: b }] = await Promise.all([
      invokeFinanceFunction('finance-portal-settings', { operation: 'get_notification_prefs' }),
      invokeFinanceFunction('finance-portal-settings', { operation: 'get_branding' }),
    ]);
    const prefMap: Record<string, any> = {};
    (p?.prefs || []).forEach((row: any) => { prefMap[row.event_type] = row; });
    setPrefs(prefMap);
    setBranding(b?.branding || null);
    setLogoUrl(b?.signed_logo_url || null);
    setCompanyName(b?.branding?.company_display_name || '');
    setTagline(b?.branding?.tagline || '');
    setAccent(b?.branding?.accent_hsl || '');
    // pull quiet hours from any existing pref (they share a global setting in our UI)
    const sample = (p?.prefs || [])[0];
    if (sample?.quiet_hours_start) setQuietStart(sample.quiet_hours_start.slice(0, 5));
    if (sample?.quiet_hours_end) setQuietEnd(sample.quiet_hours_end.slice(0, 5));
    setLoading(false);
  }, [invokeFinanceFunction]);

  useEffect(() => { void load(); }, [load]);

  const toggleChannel = async (eventType: string, channel: string) => {
    const current = prefs[eventType];
    const channels: string[] = current?.channels || ['in_app'];
    const next = channels.includes(channel)
      ? channels.filter((c) => c !== channel)
      : [...channels, channel];
    await save(eventType, { channels: next });
  };

  const toggleEnabled = async (eventType: string, enabled: boolean) => {
    await save(eventType, { is_enabled: enabled });
  };

  const save = async (eventType: string, patch: any) => {
    setSavingPref(eventType);
    const existing = prefs[eventType] || { channels: ['in_app'], is_enabled: true };
    const payload = {
      operation: 'upsert_notification_pref',
      event_type: eventType,
      channels: patch.channels ?? existing.channels,
      is_enabled: patch.is_enabled ?? existing.is_enabled,
      quiet_hours_start: quietStart || null,
      quiet_hours_end: quietEnd || null,
    };
    const { data, error } = await invokeFinanceFunction('finance-portal-settings', payload);
    setSavingPref(null);
    if (error || data?.error) { toast.error(data?.error || 'Failed to save'); return; }
    setPrefs((p) => ({ ...p, [eventType]: data.pref }));
  };

  const saveQuietHours = async () => {
    setSavingPref('__quiet__');
    // Push quiet hours to all existing prefs (no-op if none yet)
    const targets = Object.keys(prefs);
    if (targets.length === 0) targets.push(EVENT_TYPES[0].key);
    for (const k of targets) {
      const cur = prefs[k] || { channels: ['in_app'], is_enabled: true };
      await invokeFinanceFunction('finance-portal-settings', {
        operation: 'upsert_notification_pref',
        event_type: k,
        channels: cur.channels,
        is_enabled: cur.is_enabled,
        quiet_hours_start: quietStart || null,
        quiet_hours_end: quietEnd || null,
      });
    }
    setSavingPref(null);
    toast.success('Quiet hours updated');
    void load();
  };

  const saveBranding = async () => {
    setSavingBranding(true);
    const { data, error } = await invokeFinanceFunction('finance-portal-settings', {
      operation: 'upsert_branding',
      logo_storage_path: branding?.logo_storage_path ?? null,
      accent_hsl: accent || null,
      company_display_name: companyName || null,
      tagline: tagline || null,
    });
    setSavingBranding(false);
    if (error || data?.error) { toast.error(data?.error || 'Failed to save'); return; }
    toast.success('Branding saved');
    setBranding(data.branding);
  };

  const uploadLogo = async (file: File) => {
    setUploadingLogo(true);
    try {
      const { data: signed, error } = await invokeFinanceFunction('finance-portal-settings', {
        operation: 'branding_logo_upload_url',
        filename: file.name,
        content_type: file.type,
      });
      if (error || signed?.error) throw new Error(signed?.error || 'Could not get upload URL');
      const putRes = await fetch(signed.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'image/png' },
        body: file,
      });
      if (!putRes.ok) throw new Error('Upload failed');
      // Persist path
      const { data: saved } = await invokeFinanceFunction('finance-portal-settings', {
        operation: 'upsert_branding',
        logo_storage_path: signed.path,
        accent_hsl: accent || null,
        company_display_name: companyName || null,
        tagline: tagline || null,
      });
      setBranding(saved?.branding || null);
      void load();
      toast.success('Logo uploaded');
    } catch (e: any) {
      toast.error(e?.message || 'Logo upload failed');
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-5xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 px-2 text-muted-foreground hover:text-foreground">
        <Link to="/finance"><ArrowLeft className="h-4 w-4 mr-1" /> Back to dashboard</Link>
      </Button>
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="h-6 w-6 text-primary" /> Settings
        </h1>
        <p className="text-sm text-muted-foreground">Personalise notification routing and your white-label branding.</p>
      </div>



      <Tabs defaultValue="notifications" className="space-y-4">
        <TabsList>
          <TabsTrigger value="notifications"><Bell className="h-3.5 w-3.5 mr-1" /> Notifications</TabsTrigger>
          <TabsTrigger value="branding"><Palette className="h-3.5 w-3.5 mr-1" /> Branding</TabsTrigger>
          <TabsTrigger value="bookings"><CalendarClock className="h-3.5 w-3.5 mr-1" /> Bookings</TabsTrigger>
          <TabsTrigger value="display"><Smartphone className="h-3.5 w-3.5 mr-1" /> Display</TabsTrigger>
        </TabsList>

        <TabsContent value="bookings" className="space-y-4">
          <AvailabilityCard />
          <BookingsCard />
        </TabsContent>

        <TabsContent value="display" className="space-y-4">
          <UiPreferencesCard />
        </TabsContent>


        <TabsContent value="notifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" /> Quiet hours
              </CardTitle>
              <CardDescription className="text-xs">
                Email/SMS/push are suppressed inside this window. In-app is always delivered.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-3 items-end flex-wrap">
              <div>
                <Label className="text-xs">Start</Label>
                <Input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} className="w-32" />
              </div>
              <div>
                <Label className="text-xs">End</Label>
                <Input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} className="w-32" />
              </div>
              <Button size="sm" onClick={saveQuietHours} disabled={savingPref === '__quiet__'}>
                {savingPref === '__quiet__' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                Apply to all events
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Routing matrix</CardTitle>
              <CardDescription className="text-xs">Pick which channels fire for each event type.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <div className="space-y-2">
                  {EVENT_TYPES.map((ev) => {
                    const row = prefs[ev.key] || { channels: ['in_app'], is_enabled: true };
                    const enabled = row.is_enabled !== false;
                    return (
                      <div key={ev.key} className="border border-border/60 rounded-md p-3">
                        <div className="flex items-start gap-3 mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{ev.label}</p>
                            <p className="text-[11px] text-muted-foreground">{ev.description}</p>
                          </div>
                          <Switch
                            checked={enabled}
                            onCheckedChange={(v) => toggleEnabled(ev.key, v)}
                          />
                        </div>
                        <div className={`flex flex-wrap gap-1.5 ${!enabled && 'opacity-40 pointer-events-none'}`}>
                          {CHANNELS.map((ch) => {
                            const active = (row.channels || []).includes(ch.key);
                            return (
                              <Badge
                                key={ch.key}
                                variant="outline"
                                className={`cursor-pointer text-[10px] ${active ? 'bg-primary/10 text-primary border-primary/30' : 'bg-muted text-muted-foreground'}`}
                                onClick={() => toggleChannel(ev.key, ch.key)}
                              >
                                {ch.label}
                              </Badge>
                            );
                          })}
                          {savingPref === ev.key && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="branding" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Light-touch white-label</CardTitle>
              <CardDescription className="text-xs">
                Your logo + accent appear on lender packets and client-facing PDFs. Theme stays dark-gold.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-20 w-20 rounded-md border border-border/60 bg-muted/30 flex items-center justify-center overflow-hidden">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Partner logo" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-muted-foreground text-center">No logo</span>
                  )}
                </div>
                <div>
                  <input
                    id="logo-upload"
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadLogo(f);
                    }}
                  />
                  <Button asChild variant="outline" size="sm" disabled={uploadingLogo}>
                    <label htmlFor="logo-upload" className="cursor-pointer">
                      {uploadingLogo ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
                      Upload logo
                    </label>
                  </Button>
                  <p className="text-[10px] text-muted-foreground mt-1">PNG / JPG / SVG · max 2MB recommended.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Company display name</Label>
                  <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Tagline</Label>
                  <Input value={tagline} onChange={(e) => setTagline(e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-xs">Accent HSL (overrides on exports only)</Label>
                  <Input
                    value={accent}
                    onChange={(e) => setAccent(e.target.value)}
                    placeholder="e.g. 38 75% 45%"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Format: <code>H S% L%</code>. Leave blank to use the default gold accent.
                  </p>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={saveBranding} disabled={savingBranding}>
                  {savingBranding ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                  Save branding
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
