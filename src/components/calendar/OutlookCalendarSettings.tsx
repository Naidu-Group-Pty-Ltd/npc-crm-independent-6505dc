import { useState, useEffect } from 'react';
import { Settings, Clock, CalendarCheck, Zap, Save, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export interface OutlookAutomationSettings {
  autoPrepEnabled: boolean;
  prepMinutes: number;
  followUpBlocking: boolean;
  followUpDefaultDuration: number;
}

const PREP_DURATION_OPTIONS = [
  { value: '5', label: '5 minutes' },
  { value: '10', label: '10 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '20', label: '20 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '45', label: '45 minutes' },
  { value: '60', label: '1 hour' },
];

const FOLLOW_UP_DURATION_OPTIONS = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '45', label: '45 minutes' },
  { value: '60', label: '1 hour' },
  { value: '90', label: '1.5 hours' },
  { value: '120', label: '2 hours' },
];

interface OutlookCalendarSettingsProps {
  microsoftEmail: string | null;
}

export function OutlookCalendarSettings({ microsoftEmail }: OutlookCalendarSettingsProps) {
  const [settings, setSettings] = useState<OutlookAutomationSettings>({
    autoPrepEnabled: false,
    prepMinutes: 15,
    followUpBlocking: false,
    followUpDefaultDuration: 30,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const { data } = await invokeSecureFunction('outlook-calendar', {
        action: 'getOutlookSettings',
      });
      if (data?.success && data.settings) {
        setSettings(data.settings);
      }
    } catch (err) {
      console.error('[OutlookCalendarSettings] Load error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      const { data, error } = await invokeSecureFunction('outlook-calendar', {
        action: 'updateOutlookSettings',
        settings,
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to save');
      setHasChanges(false);
      toast({ title: 'Outlook settings saved' });
    } catch (err: any) {
      toast({ title: 'Failed to save settings', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const updateSetting = <K extends keyof OutlookAutomationSettings>(
    key: K,
    value: OutlookAutomationSettings[K],
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  if (!microsoftEmail) {
    return (
      <Card className="p-3 bg-muted/30">
        <p className="text-xs text-muted-foreground text-center">
          Configure your Microsoft email first to enable automation settings.
        </p>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="p-3 bg-muted/30 flex items-center justify-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading settings...</span>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
          <Zap className="h-3 w-3" />
          Automation Settings
        </h4>
        {hasChanges && (
          <Button size="sm" className="h-6 text-[10px] gap-1" onClick={saveSettings} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-2.5 w-2.5" />}
            Save
          </Button>
        )}
      </div>

      {/* Auto Prep Blocks */}
      <Card className="p-3 space-y-2.5 bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-primary" />
            <div>
              <p className="text-xs font-medium">Auto Prep Blocks</p>
              <p className="text-[10px] text-muted-foreground">
                Create prep time before GHL appointments
              </p>
            </div>
          </div>
          <Switch
            checked={settings.autoPrepEnabled}
            onCheckedChange={(v) => updateSetting('autoPrepEnabled', v)}
          />
        </div>
        {settings.autoPrepEnabled && (
          <div className="pl-5 space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">Prep duration</Label>
            <Select
              value={String(settings.prepMinutes)}
              onValueChange={(v) => updateSetting('prepMinutes', parseInt(v))}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PREP_DURATION_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[9px] text-muted-foreground">
              📋 A tentative "Prep" event will be auto-created on your Outlook calendar before each new GHL booking.
            </p>
          </div>
        )}
      </Card>

      {/* Follow-Up Calendar Blocking */}
      <Card className="p-3 space-y-2.5 bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-3.5 w-3.5 text-primary" />
            <div>
              <p className="text-xs font-medium">Follow-Up Blocking</p>
              <p className="text-[10px] text-muted-foreground">
                Block Outlook time for pipeline follow-ups
              </p>
            </div>
          </div>
          <Switch
            checked={settings.followUpBlocking}
            onCheckedChange={(v) => updateSetting('followUpBlocking', v)}
          />
        </div>
        {settings.followUpBlocking && (
          <div className="pl-5 space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">Default block duration</Label>
            <Select
              value={String(settings.followUpDefaultDuration)}
              onValueChange={(v) => updateSetting('followUpDefaultDuration', parseInt(v))}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FOLLOW_UP_DURATION_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[9px] text-muted-foreground">
              📅 When a follow-up date is set on a client, a tentative block is auto-created on your Outlook calendar.
            </p>
          </div>
        )}
      </Card>

      {/* Status indicator */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[9px]">
          {[
            settings.autoPrepEnabled && 'Prep',
            settings.followUpBlocking && 'Follow-ups',
          ].filter(Boolean).join(' + ') || 'No automations active'}
        </Badge>
      </div>
    </div>
  );
}
