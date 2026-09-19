/**
 * Batch 9 — UI preferences card (density, default landing, mobile flag).
 * Batch 13 — extended with theme, celebrations, and "replay tour".
 */
import { useEffect, useState } from 'react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, Smartphone, Sparkles, PartyPopper } from 'lucide-react';
import { toast } from 'sonner';
import {
  applyFinanceTheme, applyFinanceDensity, FinanceTheme, FinanceDensity,
} from '@/lib/finance-portal/theme';
import {
  setCelebrationsEnabled, celebrationsEnabled, triggerFinanceCelebration,
} from '@/lib/finance-portal/celebrate';
import { resetFinanceTour } from '@/components/finance-portal/FinanceOnboardingTour';

const FN = 'finance-portal-batch9-10';

export function UiPreferencesCard() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [density, setDensity] = useState<FinanceDensity>('comfortable');
  const [landing, setLanding] = useState('dashboard');
  const [mobileFlag, setMobileFlag] = useState(false);
  const [theme, setTheme] = useState<FinanceTheme>('dark');
  const [celebrate, setCelebrate] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await invokeFinanceFunction(FN, { operation: 'ui_prefs_get' });
      const p = data?.prefs;
      if (p) {
        setDensity((p.density ?? 'comfortable') as FinanceDensity);
        setLanding(p.default_landing ?? 'dashboard');
        setMobileFlag(!!p.mobile_optimized);
        const extra = p.prefs ?? {};
        if (extra.theme) setTheme(extra.theme as FinanceTheme);
        if (typeof extra.celebrations_enabled === 'boolean') {
          setCelebrate(extra.celebrations_enabled);
        }
      }
      setCelebrate(celebrationsEnabled());
      setLoading(false);
    })();
  }, [invokeFinanceFunction]);

  const save = async () => {
    setSaving(true);
    const { error } = await invokeFinanceFunction(FN, {
      operation: 'ui_prefs_set',
      density,
      default_landing: landing,
      mobile_optimized: mobileFlag,
      prefs: { theme, celebrations_enabled: celebrate },
    });
    setSaving(false);
    if (error) return toast.error('Save failed');
    applyFinanceTheme(theme);
    applyFinanceDensity(density);
    setCelebrationsEnabled(celebrate);
    toast.success('Preferences saved');
    if (celebrate) triggerFinanceCelebration('generic');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-primary" /> Display, theme & delight
        </CardTitle>
        <CardDescription>Customise density, default landing page, theme and celebration moments.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label className="text-xs">Table density</Label>
                <Select value={density} onValueChange={(v) => setDensity(v as FinanceDensity)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="comfortable">Comfortable</SelectItem>
                    <SelectItem value="compact">Compact</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Default landing</Label>
                <Select value={landing} onValueChange={setLanding}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dashboard">Dashboard</SelectItem>
                    <SelectItem value="purchase-files">Active Purchase Files</SelectItem>
                    <SelectItem value="pipeline">Pipeline Kanban</SelectItem>
                    <SelectItem value="client-inbox">Client Inbox</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Theme</Label>
                <Select value={theme} onValueChange={(v) => setTheme(v as FinanceTheme)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dark">NPC Dark Gold (default)</SelectItem>
                    <SelectItem value="midnight">Midnight Indigo</SelectItem>
                    <SelectItem value="graphite">Graphite Neutral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div>
                  <Label className="text-sm flex items-center gap-1.5">
                    <PartyPopper className="h-3.5 w-3.5 text-primary" /> Celebrations
                  </Label>
                  <p className="text-xs text-muted-foreground">Confetti on settlements & wins.</p>
                </div>
                <Switch checked={celebrate} onCheckedChange={setCelebrate} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <Label className="text-sm">Mobile-optimised UI</Label>
                <p className="text-xs text-muted-foreground">Use compact, touch-friendly spacing when opening on phone.</p>
              </div>
              <Switch checked={mobileFlag} onCheckedChange={setMobileFlag} />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button onClick={save} disabled={saving} size="sm">
                {saving ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Save className="h-3 w-3 mr-1.5" />}
                Save preferences
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  resetFinanceTour();
                  window.dispatchEvent(new Event('finance:start-tour'));
                }}
              >
                <Sparkles className="h-3 w-3 mr-1.5" /> Replay onboarding tour
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
