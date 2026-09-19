import { useState, useEffect, useCallback } from 'react';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Settings, LayoutDashboard, User, TrendingUp, Building2, BarChart3,
  Briefcase, FileText, Mail, MessageSquare, Bell, CalendarDays,
  Save, Loader2, Palette, Clock, Type, Shield, Eye, Plus, Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { useGHLCalendar } from '@/hooks/useGHLCalendar';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

interface BookingCalendarOption {
  id: string;
  name: string;
  description?: string;
}

interface PortalConfig {
  id: string;
  module_dashboard: boolean;
  module_profile: boolean;
  module_deal_progress: boolean;
  module_properties: boolean;
  module_property_insights: boolean;
  module_employment: boolean;
  module_documents: boolean;
  module_emails: boolean;
  module_messages: boolean;
  module_notifications: boolean;
  module_booking: boolean;
  welcome_title: string;
  welcome_message: string;
  welcome_banner_url: string | null;
  default_access_level: string;
  booking_calendar_id: string | null;
  booking_calendar_name: string | null;
  booking_calendars: BookingCalendarOption[];
  booking_slot_duration: number;
  booking_working_hours_start: number;
  booking_working_hours_end: number;
  booking_lead_time_hours: number;
  booking_max_advance_days: number;
  booking_confirmation_email: boolean;
  booking_team_notification_email: string | null;
  booking_intro_text: string;
  portal_accent_color: string | null;
  portal_footer_text: string;
}

const MODULE_ITEMS = [
  { key: 'module_dashboard', label: 'Dashboard', icon: LayoutDashboard, desc: 'Main portal landing page' },
  { key: 'module_profile', label: 'My Profile', icon: User, desc: 'Personal details editing' },
  { key: 'module_deal_progress', label: 'Deal Progress', icon: TrendingUp, desc: 'Visual deal pipeline tracker' },
  { key: 'module_properties', label: 'Properties', icon: Building2, desc: 'Property portfolio view' },
  { key: 'module_property_insights', label: 'Property Insights', icon: BarChart3, desc: 'Equity, LVR, yield analytics' },
  { key: 'module_employment', label: 'Finances', icon: Briefcase, desc: 'Employment and income details' },
  { key: 'module_documents', label: 'Documents', icon: FileText, desc: 'File uploads and downloads' },
  { key: 'module_reports', label: 'Reports', icon: FileText, desc: 'Published reports for clients' },
  { key: 'module_messages', label: 'Messages', icon: MessageSquare, desc: 'Advisor messaging' },
  { key: 'module_notifications', label: 'Notifications', icon: Bell, desc: 'Activity alerts and updates' },
  { key: 'module_booking', label: 'Book Appointment', icon: CalendarDays, desc: 'Calendar booking via GHL' },
] as const;

export default function PortalConfig() {
  const queryClient = useQueryClient();
  const { canEdit: canEditPortal } = useModulePermissions('portal_config');
  const [config, setConfig] = useState<PortalConfig | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const { calendars, fetchCalendarData } = useGHLCalendar();

  const DEFAULT_CONFIG: PortalConfig = {
    id: '',
    module_dashboard: true,
    module_profile: true,
    module_deal_progress: true,
    module_properties: true,
    module_property_insights: true,
    module_employment: true,
    module_documents: true,
    module_emails: true,
    module_messages: true,
    module_notifications: true,
    module_booking: true,
    welcome_title: 'Welcome to your Client Portal',
    welcome_message: 'Access your property investment details, track your deal progress, and communicate with your advisor.',
    welcome_banner_url: null,
    default_access_level: 'read_only',
    booking_calendar_id: null,
    booking_calendar_name: null,
    booking_calendars: [],
    booking_slot_duration: 30,
    booking_working_hours_start: 9,
    booking_working_hours_end: 17,
    booking_lead_time_hours: 24,
    booking_max_advance_days: 30,
    booking_confirmation_email: true,
    booking_team_notification_email: null,
    booking_intro_text: 'Schedule a consultation with our team.',
    portal_accent_color: null,
    portal_footer_text: 'Secured Portal • End-to-end encrypted',
  };

  // Fetch config using supabase client directly (manage-client-data doesn't support reads)
  const { data, isLoading } = useQuery({
    queryKey: ['portal-configuration'],
    queryFn: async () => {
      const { supabase } = await import('@/integrations/supabase/client');
      const { data: rows, error } = await supabase
        .from('portal_configuration')
        .select('*')
        .limit(1);
      if (error) throw new Error(error.message);
      return rows?.[0] || null;
    },
  });

  useEffect(() => {
    if (data) {
      const row = data as any;
      setConfig({
        ...row,
        booking_calendars: Array.isArray(row.booking_calendars) ? row.booking_calendars : [],
      } as PortalConfig);
    } else if (!isLoading && !data) {
      setConfig(DEFAULT_CONFIG);
    }
  }, [data, isLoading]);

  // Load GHL calendars for the booking selector
  useEffect(() => {
    fetchCalendarData();
  }, [fetchCalendarData]);

  const updateConfig = useCallback((updates: Partial<PortalConfig>) => {
    setConfig(prev => prev ? { ...prev, ...updates } : null);
    setHasChanges(true);
  }, []);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error('No config');
      const configData = { ...config };
      // Ensure we have an id for upsert conflict resolution
      if (!configData.id) {
        configData.id = crypto.randomUUID();
      }
      const { error } = await invokeSecureFunction('manage-client-data', {
        operation: 'upsert',
        table: 'portal_configuration',
        data: configData,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setHasChanges(false);
      toast.success('Portal configuration saved');
      queryClient.invalidateQueries({ queryKey: ['portal-configuration'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save configuration');
    },
  });

  if (isLoading || !config) {
    return (
      <DashboardThemeFrame variant="page" className="flex min-h-[400px] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card/80 px-5 py-4 text-sm text-muted-foreground shadow-sm dark:border-white/10 dark:bg-background/70">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span>Loading client portal settings…</span>
        </div>
      </DashboardThemeFrame>
    );
  }

  return (
    <DashboardThemeFrame variant="page" className="min-h-0 space-y-6 pb-28">
      {/* Header */}
      <DashboardThemeFrame
        as="header"
        variant="hero"
        className="isolate flex min-w-0 flex-col gap-5 border-primary/20 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_32%),linear-gradient(135deg,hsl(var(--card))_0%,hsl(var(--background))_54%,hsl(var(--muted)/0.42)_100%)] dark:bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.20),transparent_34%),linear-gradient(135deg,hsl(var(--card))_0%,hsl(var(--background))_58%,hsl(var(--primary)/0.08)_100%)] sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
        <div className="pointer-events-none absolute -left-16 -top-20 h-44 w-44 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 bottom-0 h-40 w-40 rounded-full bg-warning/10 blur-3xl" />
        <div className="relative flex min-w-0 flex-1 items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-sm ring-1 ring-primary/10 dark:bg-primary/15">
            <Settings className="h-6 w-6" />
          </div>
          <div className="min-w-0 space-y-2">
            <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Client portal controls
            </div>
            <div className="min-w-0 space-y-1">
              <h1 className="break-words text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Client Portal
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">Configure modules, branding, and booking options for your clients</p>
            </div>
          </div>
        </div>
        <div className="relative flex w-full shrink-0 flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          {hasChanges && (
            <span className="rounded-full border border-warning/25 bg-warning/10 px-3 py-1 text-center text-xs font-medium text-warning dark:text-warning">
              Unsaved changes pending
            </span>
          )}
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!hasChanges || saveMutation.isPending}
            className="min-h-11 rounded-full bg-primary px-5 font-semibold text-primary-foreground shadow-[0_16px_34px_hsl(var(--primary)/0.22)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary-hover hover:shadow-[0_20px_44px_hsl(var(--primary)/0.28)] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 disabled:translate-y-0 disabled:opacity-55 sm:min-w-[170px]"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save Changes
          </Button>
        </div>
      </DashboardThemeFrame>

      <Tabs defaultValue="modules" className="min-h-0 min-w-0 space-y-6">
        <DashboardThemeFrame variant="toolbar" className="overflow-x-auto p-1.5 [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]">
          <TabsList className="flex h-auto min-w-max flex-1 items-center justify-start gap-1 bg-transparent p-0">
            <TabsTrigger value="modules" className="min-h-11 min-w-[9rem] flex-1 gap-2 rounded-xl border border-transparent px-4 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:border-primary/20 hover:bg-primary/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_12px_28px_hsl(var(--primary)/0.22)] sm:min-w-0">
              <Eye className="h-4 w-4" /> Modules
            </TabsTrigger>
            <TabsTrigger value="welcome" className="min-h-11 min-w-[9rem] flex-1 gap-2 rounded-xl border border-transparent px-4 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:border-primary/20 hover:bg-primary/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_12px_28px_hsl(var(--primary)/0.22)] sm:min-w-0">
              <Type className="h-4 w-4" /> Welcome
            </TabsTrigger>
            <TabsTrigger value="booking" className="min-h-11 min-w-[9rem] flex-1 gap-2 rounded-xl border border-transparent px-4 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:border-primary/20 hover:bg-primary/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_12px_28px_hsl(var(--primary)/0.22)] sm:min-w-0">
              <CalendarDays className="h-4 w-4" /> Booking
            </TabsTrigger>
            <TabsTrigger value="access" className="min-h-11 min-w-[9rem] flex-1 gap-2 rounded-xl border border-transparent px-4 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:border-primary/20 hover:bg-primary/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_12px_28px_hsl(var(--primary)/0.22)] sm:min-w-0">
              <Shield className="h-4 w-4" /> Access
            </TabsTrigger>
          </TabsList>
        </DashboardThemeFrame>

        {/* MODULE TOGGLES */}
        <TabsContent value="modules" className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-[1.5rem]">
          <Card className="min-w-0 overflow-hidden border-border/70 bg-card/95 shadow-[0_18px_48px_hsl(var(--foreground)/0.07)] dark:border-white/10 dark:bg-background/75 dark:shadow-black/30">
            <CardHeader className="border-b border-border/60 bg-muted/20 dark:border-white/10 dark:bg-white/[0.03]">
              <CardTitle>Portal Modules</CardTitle>
              <CardDescription>Enable or disable specific sections of the client portal</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {MODULE_ITEMS.map((item) => {
                const isEnabled = (config as any)[item.key] ?? true;

                return (
                  <div
                    key={item.key}
                    className="group flex min-w-0 flex-col gap-4 rounded-2xl border border-border/65 bg-background/55 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-primary/5 hover:shadow-[0_14px_34px_hsl(var(--foreground)/0.08)] dark:border-white/10 dark:bg-background/35 dark:hover:bg-primary/10 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm ring-1 ring-primary/10 transition-colors group-hover:bg-primary group-hover:text-primary-foreground dark:bg-primary/15">
                        <item.icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="break-words text-sm font-semibold text-foreground">{item.label}</p>
                          <Badge
                            variant="outline"
                            className={isEnabled
                              ? 'border-primary/30 bg-primary/10 text-primary'
                              : 'border-border/70 bg-muted/40 text-muted-foreground'}
                          >
                            {isEnabled ? 'Enabled' : 'Disabled'}
                          </Badge>
                        </div>
                        <p className="break-words text-xs leading-5 text-muted-foreground">{item.desc}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-3 rounded-full border border-border/60 bg-card/70 px-3 py-2 dark:border-white/10 dark:bg-background/60 sm:justify-end">
                      <span className="text-xs font-medium text-muted-foreground">{isEnabled ? 'Active' : 'Off'}</span>
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={(checked) => updateConfig({ [item.key]: checked } as any)}
                        aria-label={`Toggle ${item.label}`}
                        className="data-[state=checked]:bg-primary"
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* WELCOME MESSAGE */}
        <TabsContent value="welcome" className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-[1.5rem]">
          <Card className="min-w-0 overflow-hidden border-border/70 bg-card/95 shadow-[0_18px_48px_hsl(var(--foreground)/0.07)] dark:border-white/10 dark:bg-background/75 dark:shadow-black/30">
            <CardHeader className="border-b border-border/60 bg-muted/20 dark:border-white/10 dark:bg-white/[0.03]">
              <CardTitle>Welcome Message</CardTitle>
              <CardDescription>Customise the welcome text shown on the portal dashboard</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-5 rounded-2xl border border-border/65 bg-background/55 p-4 dark:border-white/10 dark:bg-background/35 sm:p-5">
                <div className="space-y-2.5">
                  <Label className="text-sm font-semibold text-foreground">Welcome Title</Label>
                  <Input
                    value={config.welcome_title || ''}
                    onChange={(e) => updateConfig({ welcome_title: e.target.value })}
                    placeholder="Welcome to your Client Portal"
                    className="min-h-11 rounded-xl border-border/70 bg-card/80 text-foreground shadow-sm transition-colors focus-visible:border-primary focus-visible:ring-primary/30 dark:border-white/10 dark:bg-background/60"
                  />
                </div>

                <div className="space-y-2.5">
                  <Label className="text-sm font-semibold text-foreground">Welcome Message</Label>
                  <Textarea
                    value={config.welcome_message || ''}
                    onChange={(e) => updateConfig({ welcome_message: e.target.value })}
                    placeholder="Access your property investment details..."
                    rows={6}
                    className="min-h-[150px] resize-none rounded-xl border-border/70 bg-card/80 text-foreground shadow-sm transition-colors focus-visible:border-primary focus-visible:ring-primary/30 dark:border-white/10 dark:bg-background/60"
                  />
                </div>

                <div className="space-y-2.5">
                  <Label className="text-sm font-semibold text-foreground">Banner Image URL (optional)</Label>
                  <Input
                    value={config.welcome_banner_url || ''}
                    onChange={(e) => updateConfig({ welcome_banner_url: e.target.value || null })}
                    placeholder="https://..."
                    className="min-h-11 min-w-0 rounded-xl border-border/70 bg-card/80 font-mono text-sm text-foreground shadow-sm transition-colors focus-visible:border-primary focus-visible:ring-primary/30 dark:border-white/10 dark:bg-background/60"
                  />
                </div>
              </div>

              <Separator className="bg-border/70" />

              <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4 dark:border-primary/20 dark:bg-primary/10 sm:p-5">
                <div className="space-y-2.5">
                  <Label className="text-sm font-semibold text-foreground">Portal Footer Text</Label>
                  <Input
                    value={config.portal_footer_text || ''}
                    onChange={(e) => updateConfig({ portal_footer_text: e.target.value })}
                    placeholder="Secured Portal • End-to-end encrypted"
                    className="min-h-11 min-w-0 rounded-xl border-border/70 bg-card/90 text-foreground shadow-sm transition-colors focus-visible:border-primary focus-visible:ring-primary/30 dark:border-white/10 dark:bg-background/70"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* BOOKING / CALENDAR */}
        <TabsContent value="booking" className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-[1.5rem]">
          <Card className="min-w-0 overflow-hidden border-border/70 bg-card/95 shadow-[0_18px_48px_hsl(var(--foreground)/0.07)] dark:border-white/10 dark:bg-background/75 dark:shadow-black/30">
            <CardHeader className="border-b border-border/60 bg-muted/20 dark:border-white/10 dark:bg-white/[0.03]">
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />
                Booking Configuration
              </CardTitle>
              <CardDescription>Configure the appointment booking system for the client portal</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-4 shadow-sm dark:border-primary/25 dark:bg-primary/10 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0 space-y-1">
                  <p className="font-semibold text-foreground">Enable Booking Module</p>
                  <p className="break-words text-sm text-muted-foreground">Allow clients to book appointments through the portal</p>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-3 rounded-full border border-primary/20 bg-card/75 px-3 py-2 dark:bg-background/60 sm:justify-end">
                  <span className="text-xs font-medium text-muted-foreground">{config.module_booking ? 'Enabled' : 'Disabled'}</span>
                  <Switch
                    checked={config.module_booking}
                    onCheckedChange={(checked) => updateConfig({ module_booking: checked })}
                    aria-label="Enable Booking Module"
                    className="data-[state=checked]:bg-primary"
                  />
                </div>
              </div>

              {config.module_booking && (
                <>
                  <Separator className="bg-border/70" />

                  <div className="grid grid-cols-1 gap-4 rounded-2xl border border-border/65 bg-background/55 p-4 dark:border-white/10 dark:bg-background/35 sm:p-5">
                    {/* Multi-calendar manager */}
                    <div className="min-w-0 space-y-3">
                      <div className="space-y-1">
                        <Label className="text-sm font-semibold text-foreground">Available Calendars for Clients</Label>
                        <p className="break-words text-xs leading-5 text-muted-foreground">Add GHL calendars that clients can choose from when booking. Clients select one calendar per booking.</p>
                      </div>
                      
                      {/* Existing calendars list */}
                      {(config.booking_calendars || []).length > 0 && (
                        <div className="space-y-3">
                          {config.booking_calendars.map((bc, idx) => (
                            <div key={bc.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/70 bg-card/75 p-3 shadow-sm dark:border-white/10 dark:bg-background/55 lg:flex-row lg:items-center">
                              <div className="flex min-w-0 flex-1 items-start gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary dark:bg-primary/15">
                                  <CalendarDays className="h-4 w-4" />
                                </div>
                                <div className="min-w-0 space-y-1">
                                  <p className="break-words text-sm font-semibold text-foreground">{bc.name}</p>
                                  {bc.description && <p className="break-words text-xs text-muted-foreground">{bc.description}</p>}
                                  <p className="break-all font-mono text-xs text-muted-foreground">{bc.id}</p>
                                </div>
                              </div>
                              <div className="flex min-w-0 flex-col gap-2 sm:flex-row lg:w-[22rem] lg:shrink-0">
                                <Input
                                  className="min-h-10 min-w-0 flex-1 rounded-xl border-border/70 bg-background/80 text-xs shadow-sm focus-visible:border-primary focus-visible:ring-primary/30 dark:border-white/10 dark:bg-background/70"
                                  placeholder="Label shown to clients..."
                                  value={bc.description || ''}
                                  onChange={(e) => {
                                    const updated = [...config.booking_calendars];
                                    updated[idx] = { ...updated[idx], description: e.target.value };
                                    updateConfig({ booking_calendars: updated });
                                  }}
                                />
                                <Button
                                  variant="outline"
                                  size="icon"
                                  aria-label={`Remove ${bc.name}`}
                                  className="shrink-0 border-destructive/30 text-destructive hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => {
                                    const updated = config.booking_calendars.filter((_, i) => i !== idx);
                                    updateConfig({ booking_calendars: updated });
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add calendar selector */}
                      {(() => {
                        const usedIds = new Set((config.booking_calendars || []).map(c => c.id));
                        const available = calendars.filter(c => !usedIds.has(c.id));
                        if (available.length === 0 && calendars.length > 0) return (
                          <p className="text-xs text-muted-foreground italic">All available GHL calendars have been added.</p>
                        );
                        return (
                          <div className="flex min-w-0 items-center gap-2">
                            <Select
                              value=""
                              onValueChange={(val) => {
                                const cal = calendars.find(c => c.id === val);
                                if (cal) {
                                  updateConfig({
                                    booking_calendars: [...(config.booking_calendars || []), { id: cal.id, name: cal.name, description: '' }],
                                  });
                                }
                              }}
                            >
                              <SelectTrigger className="min-h-11 min-w-0 flex-1 rounded-xl border-border/70 bg-card/80 shadow-sm focus:ring-primary/30 dark:border-white/10 dark:bg-background/60">
                                <SelectValue placeholder="Add a GHL calendar..." />
                              </SelectTrigger>
                              <SelectContent>
                                {available.map((cal) => (
                                  <SelectItem key={cal.id} value={cal.id}>
                                    {cal.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <Separator className="bg-border/70" />

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2 rounded-2xl border border-border/65 bg-background/55 p-4 dark:border-white/10 dark:bg-background/35">
                      <Label className="text-sm font-semibold text-foreground">Slot Duration (minutes)</Label>
                      <Select
                        value={String(config.booking_slot_duration)}
                        onValueChange={(val) => updateConfig({ booking_slot_duration: Number(val) })}
                      >
                        <SelectTrigger className="min-h-11 rounded-xl border-border/70 bg-card/80 shadow-sm focus:ring-primary/30 dark:border-white/10 dark:bg-background/60">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="15">15 minutes</SelectItem>
                          <SelectItem value="30">30 minutes</SelectItem>
                          <SelectItem value="45">45 minutes</SelectItem>
                          <SelectItem value="60">60 minutes</SelectItem>
                          <SelectItem value="90">90 minutes</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2 rounded-2xl border border-border/65 bg-background/55 p-4 dark:border-white/10 dark:bg-background/35">
                      <Label className="text-sm font-semibold text-foreground">Minimum Lead Time (hours)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={168}
                        value={config.booking_lead_time_hours}
                        onChange={(e) => updateConfig({ booking_lead_time_hours: Number(e.target.value) })}
                        className="min-h-11 rounded-xl border-border/70 bg-card/80 shadow-sm focus-visible:border-primary focus-visible:ring-primary/30 dark:border-white/10 dark:bg-background/60"
                      />
                      <p className="text-xs text-muted-foreground">How far in advance clients must book</p>
                    </div>

                    <div className="space-y-2 rounded-2xl border border-border/65 bg-background/55 p-4 dark:border-white/10 dark:bg-background/35">
                      <Label className="text-sm font-semibold text-foreground">Max Advance Booking (days)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={90}
                        value={config.booking_max_advance_days}
                        onChange={(e) => updateConfig({ booking_max_advance_days: Number(e.target.value) })}
                        className="min-h-11 rounded-xl border-border/70 bg-card/80 shadow-sm focus-visible:border-primary focus-visible:ring-primary/30 dark:border-white/10 dark:bg-background/60"
                      />
                      <p className="text-xs text-muted-foreground">How far ahead clients can book</p>
                    </div>
                  </div>

                  <Separator className="bg-border/70" />

                  <div className="space-y-4 rounded-2xl border border-border/65 bg-background/55 p-4 dark:border-white/10 dark:bg-background/35 sm:p-5">
                    <h4 className="font-medium text-sm flex items-center gap-2">
                      <Mail className="h-4 w-4 text-primary" />
                      Email Notifications
                    </h4>
                    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-card/70 p-3 dark:border-white/10 dark:bg-background/55 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium">Send Client Confirmation</p>
                        <p className="text-xs text-muted-foreground">Email the client a booking confirmation</p>
                      </div>
                      <Switch
                        checked={config.booking_confirmation_email}
                        onCheckedChange={(checked) => updateConfig({ booking_confirmation_email: checked })}
                        aria-label="Send Client Confirmation"
                        className="data-[state=checked]:bg-primary"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-foreground">Team Notification Email</Label>
                      <Input
                        type="email"
                        value={config.booking_team_notification_email || ''}
                        onChange={(e) => updateConfig({ booking_team_notification_email: e.target.value || null })}
                        placeholder="team@yourcompany.com"
                        className="min-h-11 rounded-xl border-border/70 bg-card/80 shadow-sm focus-visible:border-primary focus-visible:ring-primary/30 dark:border-white/10 dark:bg-background/60"
                      />
                      <p className="text-xs text-muted-foreground">Receive an email when a client books an appointment</p>
                    </div>
                  </div>

                  <Separator className="bg-border/70" />

                  <div className="space-y-2 rounded-2xl border border-primary/15 bg-primary/5 p-4 dark:border-primary/20 dark:bg-primary/10 sm:p-5">
                    <Label className="text-sm font-semibold text-foreground">Booking Introduction Text</Label>
                    <Textarea
                      value={config.booking_intro_text || ''}
                      onChange={(e) => updateConfig({ booking_intro_text: e.target.value })}
                      placeholder="Schedule a consultation with our team..."
                      rows={4}
                      className="min-h-[120px] resize-none rounded-xl border-border/70 bg-card/90 shadow-sm focus-visible:border-primary focus-visible:ring-primary/30 dark:border-white/10 dark:bg-background/70"
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ACCESS LEVEL DEFAULTS */}
        <TabsContent value="access" className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-[1.5rem]">
          <Card className="min-w-0 overflow-hidden border-border/70 bg-card/95 shadow-[0_18px_48px_hsl(var(--foreground)/0.07)] dark:border-white/10 dark:bg-background/75 dark:shadow-black/30">
            <CardHeader className="border-b border-border/60 bg-muted/20 dark:border-white/10 dark:bg-white/[0.03]">
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Access Level Defaults
              </CardTitle>
              <CardDescription>Set the default permissions for new client portal users</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-2xl border border-border/65 bg-background/55 p-4 dark:border-white/10 dark:bg-background/35 sm:p-5">
                <div className="max-w-xl space-y-3">
                  <Label className="text-sm font-semibold text-foreground">Default Access Level for New Users</Label>
                  <Select
                    value={config.default_access_level}
                    onValueChange={(val) => updateConfig({ default_access_level: val })}
                  >
                    <SelectTrigger className="min-h-11 w-full rounded-xl border-border/70 bg-card/80 shadow-sm focus:ring-primary/30 dark:border-white/10 dark:bg-background/60 md:w-[340px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="read_only">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge variant="outline" className="border-border/70 bg-muted/40 text-xs text-muted-foreground">Read Only</Badge>
                          <span className="text-xs text-muted-foreground">View data but cannot edit</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="limited_edit">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge variant="outline" className="border-warning/40 bg-warning/10 text-xs text-warning">Limited Edit</Badge>
                          <span className="text-xs text-muted-foreground">Edit profile and documents only</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="full_edit">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge variant="outline" className="border-success/40 bg-success/10 text-xs text-success">Full Edit</Badge>
                          <span className="text-xs text-muted-foreground">Edit all available sections</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator className="bg-border/70" />

              <div className="rounded-2xl border border-border/65 bg-background/55 p-4 dark:border-white/10 dark:bg-background/35 sm:p-5">
                <div className="mb-4 flex min-w-0 items-center gap-2">
                  <Shield className="h-4 w-4 shrink-0 text-primary" />
                  <h4 className="text-sm font-semibold text-foreground">Access Level Guide</h4>
                </div>
                <div className="grid gap-3 text-sm text-muted-foreground lg:grid-cols-3">
                  <div className="min-w-0 rounded-2xl border border-border/70 bg-card/75 p-4 dark:border-white/10 dark:bg-background/55">
                    <Badge variant="outline" className="mb-3 border-border/70 bg-muted/40 text-xs text-muted-foreground">Read Only</Badge>
                    <p className="break-words leading-6">Clients can view all enabled portal sections but cannot modify any data. Documents are downloadable but not uploadable.</p>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-warning/30 bg-warning/10 p-4 dark:border-warning/25 dark:bg-warning/10">
                    <Badge variant="outline" className="mb-3 border-warning/40 bg-warning/10 text-xs text-warning">Limited</Badge>
                    <p className="break-words leading-6">Clients can edit their personal profile and upload documents. Other sections remain read-only.</p>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-success/30 bg-success/10 p-4 dark:border-success/25 dark:bg-success/10">
                    <Badge variant="outline" className="mb-3 border-success/40 bg-success/10 text-xs text-success">Full Edit</Badge>
                    <p className="break-words leading-6">Clients have full editing access across profile, properties, employment/financial details, and documents.</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Floating save bar */}
      {hasChanges && (
        <div className="fixed inset-x-4 bottom-4 z-50 flex justify-center sm:bottom-6">
          <div className="flex w-full max-w-xl flex-col gap-3 rounded-2xl border border-warning/25 bg-card/95 px-4 py-3 shadow-2xl shadow-black/10 ring-1 ring-warning/10 backdrop-blur dark:bg-background/95 dark:shadow-black/40 sm:w-auto sm:flex-row sm:items-center sm:rounded-full sm:px-6" role="status" aria-live="polite">
            <span className="min-w-0 text-sm text-muted-foreground">You have unsaved changes</span>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="rounded-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {saveMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
              Save
            </Button>
          </div>
        </div>
      )}
    </DashboardThemeFrame>
  );
}
