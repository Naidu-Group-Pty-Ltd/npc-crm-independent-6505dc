import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import MarketSourceProbePanel from '@/components/integrations/MarketSourceProbePanel';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Settings2,
  Database,
  Phone,
  Mail,
  Brain,
  Webhook,
  Eye,
  EyeOff,
  Save,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Cloud,
  RefreshCw,
  AlertCircle,
  Shield,
  Search,
  Map as MapIcon,
  FileText,
  Sparkles,
  Megaphone,
  Bell,
  CreditCard,
  SlidersHorizontal,
  BarChart3,
  Users,
  Lock,
  Image as ImageIcon,
  Calendar,
  Package,
  Code2,
  Video,
  Coins,
  Building2,
  Mic,
  Globe,
  MessageSquare,
  ShoppingCart,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SearchInput } from '@/components/ui/search-input';
import { PlannedIntegrations } from '@/components/integrations/PlannedIntegrations';
import { BrandMark } from '@/components/integrations/BrandMark';
import { getBrandProfile } from '@/lib/integrations/brandProfiles';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import {
  INTEGRATIONS,
  INTEGRATION_CATEGORIES,
  getSupabaseSecretName,
  integrationSearchIndex,
  type IntegrationCategoryId,
  type IntegrationDefinition,
} from '@/lib/integrations/registry';

type IntegrationConfig = IntegrationDefinition;

const FALLBACK_ICONS: Record<IntegrationDefinition['fallbackIcon'], React.ReactNode> = {
  brain: <Brain className="h-6 w-6" />,
  database: <Database className="h-6 w-6" />,
  phone: <Phone className="h-6 w-6" />,
  mail: <Mail className="h-6 w-6" />,
  webhook: <Webhook className="h-6 w-6" />,
  shield: <Shield className="h-6 w-6" />,
  cloud: <Cloud className="h-6 w-6" />,
  map: <MapIcon className="h-6 w-6" />,
  file: <FileText className="h-6 w-6" />,
  sparkles: <Sparkles className="h-6 w-6" />,
  megaphone: <Megaphone className="h-6 w-6" />,
  settings: <Settings2 className="h-6 w-6" />,
  bell: <Bell className="h-6 w-6" />,
  creditCard: <CreditCard className="h-6 w-6" />,
  barChart: <BarChart3 className="h-6 w-6" />,
  users: <Users className="h-6 w-6" />,
  lock: <Lock className="h-6 w-6" />,
  image: <ImageIcon className="h-6 w-6" />,
  calendar: <Calendar className="h-6 w-6" />,
  package: <Package className="h-6 w-6" />,
  code: <Code2 className="h-6 w-6" />,
  video: <Video className="h-6 w-6" />,
  coins: <Coins className="h-6 w-6" />,
  building: <Building2 className="h-6 w-6" />,
  mic: <Mic className="h-6 w-6" />,
  globe: <Globe className="h-6 w-6" />,
  message: <MessageSquare className="h-6 w-6" />,
  cart: <ShoppingCart className="h-6 w-6" />,
};


/** Brand-profile key for an integration (differs where the brand is shared). */
const BRAND_ID_OVERRIDES: Record<string, string> = {
  google: 'google_maps',
};

const brandIdFor = (integrationId: string) => BRAND_ID_OVERRIDES[integrationId] ?? integrationId;

const integrations: IntegrationConfig[] = INTEGRATIONS;

interface SupabaseSecretStatus {
  configured: boolean;
  configuredSecrets: string[];
  missingSecrets: string[];
}

export default function Integrations() {
  const { canEdit: canEditIntegrations } = useModulePermissions('integrations');
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [supabaseSecrets, setSupabaseSecrets] = useState<Record<string, SupabaseSecretStatus>>({});
  const [loadingSecrets, setLoadingSecrets] = useState(false);
  const [supabaseSetupRequired, setSupabaseSetupRequired] = useState(false);
  // What the SERVER said the remedy is. The banner used to assert one, which
  // was wrong on every clone — see the alert below.
  const [supabaseSetupHint, setSupabaseSetupHint] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState('all');
  const [activeCategory, setActiveCategory] = useState<IntegrationCategoryId | 'all'>('all');

  const visibleIntegrations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return INTEGRATIONS.filter((integration) => {
      if (activeCategory !== 'all' && integration.category !== activeCategory) return false;
      if (!query) return true;
      return query
        .split(/\s+/)
        .every((token) => integrationSearchIndex(integration).includes(token));
    });
  }, [search, activeCategory]);


  // Load saved integration configs from database
  useEffect(() => {
    loadIntegrationConfigs();
    checkSupabaseSecrets();
  }, []);

  const checkSupabaseSecrets = async () => {
    setLoadingSecrets(true);
    try {
      const { data, error } = await invokeSecureFunction('check-integration-secrets', {});

      if (error) {
        console.error('Error checking Supabase secrets:', error);
        return;
      }

      if (data?.success && data?.integrations) {
        setSupabaseSecrets(data.integrations);
      }
    } catch (error) {
      console.error('Failed to check Supabase secrets:', error);
    } finally {
      setLoadingSecrets(false);
    }
  };

  const loadIntegrationConfigs = async () => {
    try {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'integration_configs'
      });

      if (error) {
        console.error('Error loading integration configs:', error);
        // Table might not exist yet, that's okay
        setLoading(false);
        return;
      }

      if (data?.records) {
        const loadedValues: Record<string, string> = {};
        const loadedKeys = new Set<string>();

        data.records.forEach((config: any) => {
          loadedValues[config.key_name] = config.key_value || '';
          if (config.key_value) {
            loadedKeys.add(config.key_name);
          }
        });

        setValues(loadedValues);
        setSavedKeys(loadedKeys);
      }
    } catch (error) {
      console.error('Failed to load configs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleValueChange = (key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }));
  };

  const togglePasswordVisibility = (key: string) => {
    setShowPasswords(prev => ({ ...prev, [key]: !prev[key] }));
  };

  /**
   * Save is the WHOLE act, because a credential has two readers.
   *
   * `integration_configs` is what a Workflow Playground step resolves its
   * credentials from (`_shared/workflow/stepExecutor.ts`). The project's
   * function environment is what everything else reads —
   * `Deno.env.get('GOHIGHLEVEL_API_KEY')` and its hundred siblings. Those were
   * two buttons, and pressing the obvious one delivered a key to neither the
   * GHL client nor anything else in the product.
   *
   * The environment is written FIRST. If that fails there is a real reason and
   * the operator has to see it; recording the row first would leave a workspace
   * whose page says "saved" and whose runtime has nothing, which is the state
   * this replaces.
   */
  const saveIntegration = async (integrationId: string) => {
    const integration = integrations.find(i => i.id === integrationId);
    if (!integration) return;

    setSaving(integrationId);

    try {
      const runtime = await applyToRuntime(integration);
      if (runtime.ok === false) {
        toast({
          title: 'Not saved',
          description: runtime.error,
          variant: 'destructive',
        });
        return;
      }

      // Then the row the workflow engine reads. Same values, second store.
      for (const field of integration.fields) {
        const value = values[field.key] || '';

        const { error } = await invokeSecureFunction('manage-templates', {
          operation: 'upsert',
          table: 'integration_configs',
          data: {
            key_name: field.key,
            key_value: value,
            integration_id: integrationId,
            updated_at: new Date().toISOString()
          },
          onConflict: 'key_name'
        });

        if (error) throw new Error(error.message);

        if (value) {
          setSavedKeys(prev => new Set([...prev, field.key]));
        } else {
          setSavedKeys(prev => {
            const newSet = new Set(prev);
            newSet.delete(field.key);
            return newSet;
          });
        }
      }

      // Re-read the environment rather than assuming it. The badge beside the
      // card is the only reading of the store the product actually runs on.
      await checkSupabaseSecrets();

      toast({
        title: 'Saved and applied',
        description: runtime.description(integration.name),
      });
    } catch (error) {
      console.error('Error saving integration:', error);
      toast({
        title: 'Partly saved',
        description:
          'The credentials reached this deployment\'s runtime but the workflow record ' +
          'could not be written. ' +
          (error instanceof Error ? error.message : 'Please try again.'),
        variant: 'destructive',
      });
    } finally {
      setSaving(null);
    }
  };

  type RuntimeOutcome =
    | { ok: true; description: (name: string) => string }
    | { ok: false; error: string };

  /**
   * Put this card's credentials into the environment the runtime reads.
   *
   * On a deployment holding its own Supabase management token this writes its
   * own project. On a clone — which must never hold that token, because it is
   * account-scoped and reaches every project this organisation owns — the
   * function brokers the write through Mission Control. Which road it took
   * comes back as `via`, and is said out loud: "saved" means two different
   * things and an operator chasing a key that is not taking effect needs to
   * know which end to ask about.
   */
  const applyToRuntime = async (integration: IntegrationConfig): Promise<RuntimeOutcome> => {
    const secrets = integration.fields
      .filter(field => values[field.key]?.trim())
      .map(field => ({
        name: getSupabaseSecretName(field.key),
        value: values[field.key].trim(),
      }));

    if (secrets.length === 0) {
      /*
       * Refusing an empty submit is a control, not an obstacle.
       *
       * A stored credential is never read back into these boxes — a Supabase
       * secret cannot be — so the form is empty every time the page loads on a
       * card that is fully configured. The old Save wrote `key_value: ''` over
       * every field, which silently cleared the Workflow Playground's copy for
       * anybody who opened a card and pressed Save without retyping.
       *
       * It says so rather than saying "nothing to do", because the other thing
       * an operator may be attempting here is a deliberate clear, and this
       * page cannot do that: removing a name from the function environment is
       * a DELETE against the Management API that neither route performs.
       */
      return {
        ok: false,
        error:
          `Enter a value for at least one ${integration.name} field. A saved credential is ` +
          `never shown back in these boxes, so an empty form is not a request to clear one — ` +
          `and removing a credential is not something this page does.`,
      };
    }

    const { data, error } = await invokeSecureFunction('update-integration-secret', { secrets });
    if (error) {
      return { ok: false, error: error.message ?? 'The credentials could not be applied.' };
    }

    if (data?.setupRequired) {
      // The REMEDY travels with the refusal now. It used to be hard-coded to
      // "add a SUPABASE_ACCESS_TOKEN", which on a clone sends an operator to
      // fetch the one credential this arrangement exists to keep off their
      // project.
      setSupabaseSetupHint(data.setupHint ?? data.error ?? null);
      setSupabaseSetupRequired(true);
      return { ok: false, error: data.setupHint || data.error || 'This deployment cannot apply credentials.' };
    }

    if (!data?.success) {
      return { ok: false, error: data?.error || 'The credentials could not be applied.' };
    }

    setSupabaseSetupRequired(false);
    setSupabaseSetupHint(null);

    const applied: string[] = data.updatedSecrets ?? [];
    const warnings: string[] = data.validationWarnings ?? [];
    const where =
      data.via === 'broker'
        ? 'applied to this workspace through Mission Control'
        : 'applied to this deployment';

    return {
      ok: true,
      description: (name: string) =>
        `${name}: ${applied.length} credential(s) ${where}.` +
        (warnings.length > 0 ? ` Not applied — ${warnings.join(' ')}` : ''),
    };
  };

  // Frontend field key → Supabase secret name mapping lives in the registry.


  const getIntegrationStatus = (integration: IntegrationConfig) => {
    const requiredFields = integration.fields.filter(f => f.required !== false);
    const configuredFields = requiredFields.filter(f => savedKeys.has(f.key));

    if (configuredFields.length === 0) return 'not_configured';
    if (configuredFields.length === requiredFields.length) return 'configured';
    return 'partial';
  };

  const getCredentialTrustSummary = (integration: IntegrationConfig) => {
    const requiredFields = integration.fields.filter(f => f.required !== false);
    const configuredRequiredFields = requiredFields.filter(f => savedKeys.has(f.key));
    const status = getIntegrationStatus(integration);

    if (status === 'configured') {
      return {
        className: 'border-success/20 bg-success/10 text-success dark:text-success',
        iconClassName: 'text-success dark:text-success',
        label: 'Required credentials saved',
        detail: `${configuredRequiredFields.length}/${requiredFields.length} required fields configured`,
      };
    }

    if (status === 'partial') {
      return {
        className: 'border-brand-400/25 bg-brand-500/10 text-brand-700 dark:text-brand-300',
        iconClassName: 'text-brand-600 dark:text-brand-300',
        label: 'Partial setup',
        detail: `${configuredRequiredFields.length}/${requiredFields.length} required fields configured`,
      };
    }

    return {
      className: 'border-border/60 bg-muted/35 text-muted-foreground',
      iconClassName: 'text-muted-foreground',
      label: 'Credentials not saved yet',
      detail: `${configuredRequiredFields.length}/${requiredFields.length} required fields configured`,
    };
  };

  const getStatusBadge = (status: string) => {
    const baseBadgeClass = 'max-w-full gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none shadow-sm';

    switch (status) {
      case 'configured':
        return (
          <Badge variant="outline" className={`${baseBadgeClass} border-success/30 bg-success/10 text-success dark:text-success`}>
            <CheckCircle2 className="h-3 w-3 shrink-0" />
            <span className="truncate">Configured</span>
          </Badge>
        );
      case 'connected':
        return (
          <Badge variant="outline" className={`${baseBadgeClass} border-success/30 bg-success/10 text-success dark:text-success`}>
            <CheckCircle2 className="h-3 w-3 shrink-0" />
            <span className="truncate">Connected</span>
          </Badge>
        );
      case 'partial':
        return (
          <Badge variant="outline" className={`${baseBadgeClass} border-brand-400/35 bg-brand-500/10 text-brand-600 dark:text-brand-300`}>
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span className="truncate">Incomplete</span>
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="outline" className={`${baseBadgeClass} border-brand-400/35 bg-brand-500/10 text-brand-600 dark:text-brand-300`}>
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span className="truncate">Pending</span>
          </Badge>
        );
      case 'error':
      case 'invalid':
      case 'failed':
        return (
          <Badge variant="outline" className={`${baseBadgeClass} border-destructive/35 bg-destructive/10 text-destructive`}>
            <XCircle className="h-3 w-3 shrink-0" />
            <span className="truncate">{status.charAt(0).toUpperCase() + status.slice(1)}</span>
          </Badge>
        );
      case 'roadmap':
        return (
          <Badge variant="outline" className={`${baseBadgeClass} border-border/70 bg-muted/50 text-muted-foreground`}>
            <span className="truncate">Roadmap</span>
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className={`${baseBadgeClass} border-border/70 bg-muted/45 text-muted-foreground`}>
            <span className="truncate">Not Configured</span>
          </Badge>
        );
    }
  };

  const getIntegrationTone = (integrationId: string) => {
    const profile = getBrandProfile(integrationId);
    const hex = profile?.color ?? '6467F2';
    const hex2 = profile?.color2 ?? hex;
    const rgb = (h: string) => {
      const n = parseInt(h, 16);
      return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    };
    const c1 = rgb(hex);
    const c2 = rgb(hex2);

    return {
      card: 'hover:border-[color:var(--brand-border)]',
      cardStyle: {
        // consumed by hover ring + focus-within accents via CSS var
        ['--brand-rgb' as string]: c1,
        ['--brand-border' as string]: `rgba(${c1}, 0.45)`,
      } as React.CSSProperties,
      header:
        'bg-[linear-gradient(135deg,rgba(var(--brand-rgb),0.12),rgba(var(--brand-rgb),0.02)_60%,transparent)]',
      icon:
        'border-[color:rgba(var(--brand-rgb),0.35)] bg-[linear-gradient(135deg,rgba(var(--brand-rgb),0.14),rgba(var(--brand-rgb),0.04))] shadow-[0_14px_34px_rgba(var(--brand-rgb),0.22)] group-hover:border-[color:rgba(var(--brand-rgb),0.55)] group-hover:shadow-[0_18px_42px_rgba(var(--brand-rgb),0.30)]',
      field: 'focus-within:border-[color:rgba(var(--brand-rgb),0.45)]',
      accentBar:
        'bg-[linear-gradient(90deg,rgba(' + c1 + ',0.9),rgba(' + c2 + ',0.55),transparent)]',
    };
  };


  const getFieldGridClass = (integration: IntegrationConfig) => {
    if (integration.fields.length >= 3) {
      return 'grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3';
    }

    if (integration.fields.length > 1) {
      return 'grid min-w-0 gap-3 sm:grid-cols-2';
    }

    return 'grid min-w-0 gap-3';
  };


  const getFieldSpanClass = (integrationId: string, fieldKey: string) => {
    if (integrationId === 'make' || fieldKey.includes('WEBHOOK_URL')) {
      return 'sm:col-span-2 lg:col-span-3';
    }

    if (integrationId === 'microsoft' && fieldKey === 'MICROSOFT_CLIENT_SECRET') {
      return 'lg:col-span-1';
    }

    return '';
  };

  const getSupabaseSecretBadge = (integrationId: string) => {
    const secretStatus = supabaseSecrets[integrationId];

    if (!secretStatus) return null;

    if (secretStatus.configured) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="max-w-full gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-semibold leading-none text-success shadow-sm dark:text-success">
                <Cloud className="h-3 w-3 shrink-0" />
                <span className="truncate">Supabase</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs rounded-xl border-border/70 bg-popover/95 p-3 shadow-xl">
              <p className="text-xs font-semibold">Configured in Supabase secrets:</p>
              <ul className="mt-1 max-h-44 overflow-y-auto text-xs [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]">
                {secretStatus.configuredSecrets.map(s => (
                  <li key={s} className="text-success">✓ {s}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    } else if (secretStatus.configuredSecrets.length > 0) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="max-w-full gap-1 rounded-full border border-brand-400/35 bg-brand-500/10 px-2.5 py-1 text-[11px] font-semibold leading-none text-brand-600 shadow-sm dark:text-brand-300">
                <Cloud className="h-3 w-3 shrink-0" />
                <span className="truncate">Partial</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs rounded-xl border-border/70 bg-popover/95 p-3 shadow-xl">
              <p className="text-xs font-semibold">Supabase secrets status:</p>
              <ul className="mt-1 max-h-44 overflow-y-auto text-xs [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]">
                {secretStatus.configuredSecrets.map(s => (
                  <li key={s} className="text-success">✓ {s}</li>
                ))}
                {secretStatus.missingSecrets.map(s => (
                  <li key={s} className="text-destructive">✗ {s}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return null;
  };

  if (loading) {
    return (
      <DashboardThemeFrame
        as="main"
        variant="page"
        className="flex min-h-[50vh] items-center justify-center rounded-[2rem] bg-[radial-gradient(circle_at_center,hsl(var(--primary)/0.10),transparent_34%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background)/0.94))] p-6"
      >
        <div className="flex items-center gap-3 rounded-2xl border border-primary/15 bg-card/80 px-5 py-4 text-sm font-medium text-muted-foreground shadow-xl shadow-sm dark:shadow-black/25" aria-live="polite">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Loading integrations
        </div>
      </DashboardThemeFrame>
    );
  }

  const renderIntegrationCard = (integration: IntegrationConfig) => {
    const status = getIntegrationStatus(integration);
    const tone = getIntegrationTone(brandIdFor(integration.id));
    const trustSummary = getCredentialTrustSummary(integration);

    return (
      <Card
        key={integration.id}
        style={tone.cardStyle}
        className={`group relative min-w-0 overflow-hidden rounded-3xl border border-border/70 bg-[linear-gradient(145deg,hsl(var(--card))_0%,hsl(var(--muted)/0.18)_100%)] shadow-[0_14px_40px_rgba(15,23,42,0.08)] ring-1 ring-white/45 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_20px_52px_rgba(15,23,42,0.13),0_0_0_1px_rgba(var(--brand-rgb),0.18)] dark:border-white/10 dark:bg-background/80 dark:ring-white/10 dark:shadow-black/30 ${tone.card}`}
      >
        <div aria-hidden="true" className={`absolute inset-x-0 top-0 h-[3px] ${tone.accentBar}`} />
        <CardHeader className={`border-b border-border/50 pb-4 ${tone.header}`}>
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border backdrop-blur-sm transition-all duration-300 ${tone.icon}`}>
                <BrandMark integrationId={brandIdFor(integration.id)} fallback={FALLBACK_ICONS[integration.fallbackIcon]} size={26} />
              </div>
              <div className="min-w-0 space-y-1">
                <CardTitle className="break-words text-lg font-semibold leading-tight tracking-tight text-foreground">
                  {integration.name}
                </CardTitle>
                <CardDescription className="max-w-full break-words text-sm leading-5 text-muted-foreground">
                  {integration.description}
                </CardDescription>
              </div>
            </div>
            <div className="flex shrink-0 flex-row flex-wrap items-center gap-1.5 sm:max-w-[45%] sm:justify-end">
              {getStatusBadge(status)}
              {getSupabaseSecretBadge(integration.id)}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className={getFieldGridClass(integration)}>
            {integration.fields.map(field => {
              const isSecretField = field.type === 'password';
              const isRevealed = Boolean(showPasswords[field.key]);

              return (
                <div key={field.key} className={`min-w-0 space-y-2 rounded-2xl border border-border/45 bg-background/35 p-3 shadow-inner shadow-sm transition-colors focus-within:bg-background/55 sm:p-3.5 ${tone.field} ${getFieldSpanClass(integration.id, field.key)}`}>
                  <Label htmlFor={field.key} className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground">
                    <span className="min-w-0 truncate">{field.label}</span>
                    {field.required !== false && <span className="text-destructive ml-0.5">*</span>}
                    {isSecretField && <Shield className="ml-auto h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />}
                  </Label>
                  <div className="relative min-w-0">
                    <Input
                      id={field.key}
                      type={isSecretField && !isRevealed ? 'password' : 'text'}
                      placeholder={field.placeholder}
                      value={values[field.key] || ''}
                      onChange={(e) => handleValueChange(field.key, e.target.value)}
                      className={`min-w-0 truncate rounded-xl border-border/70 bg-card/80 shadow-inner shadow-sm transition-all placeholder:text-muted-foreground/70 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/35 ${isSecretField ? 'pr-12 font-mono text-sm tracking-[0.08em]' : 'pr-3'}`}
                    />
                    {isSecretField && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`${isRevealed ? 'Hide' : 'Show'} ${field.label}`}
                        className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-lg p-0 text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                        onClick={() => togglePasswordVisibility(field.key)}
                      >
                        {isRevealed ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className={`flex min-w-0 items-start gap-3 rounded-2xl border px-3 py-2.5 text-xs shadow-inner shadow-sm ${trustSummary.className}`}>
            <Shield className={`mt-0.5 h-4 w-4 shrink-0 ${trustSummary.iconClassName}`} aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold leading-5">{trustSummary.label}</p>
              <p className="truncate leading-5 opacity-85">{trustSummary.detail}</p>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
            {integration.docsUrl && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-center rounded-xl border border-border/50 bg-background/55 text-muted-foreground transition-all hover:border-primary/35 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 sm:w-auto"
                onClick={() => window.open(integration.docsUrl, '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                Docs
              </Button>
            )}
            {/*
              * One button, because there was never more than one act.
              *
              * "Sync to Supabase" used to sit here as a second, unlabelled
              * icon — and it was the only one of the two that put a credential
              * where the product reads it, while needing a Supabase management
              * token no clone may hold. Save performs both halves now.
              */}
            <div className="flex min-w-0 gap-2 sm:ml-auto">
              <Button
                onClick={() => saveIntegration(integration.id)}
                disabled={saving === integration.id || !canEditIntegrations}
                className="min-h-10 min-w-0 flex-1 rounded-xl bg-primary px-4 font-semibold text-primary-foreground shadow-[0_12px_28px_hsl(var(--primary)/0.20)] transition-all hover:bg-primary-hover hover:shadow-[0_16px_34px_hsl(var(--primary)/0.24)] focus-visible:ring-2 focus-visible:ring-primary/45 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
              >
                {saving === integration.id ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderGroupedIntegrations = (list: IntegrationConfig[], emptyMessage: string) => {
    if (list.length === 0) {
      return (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border/70 bg-[linear-gradient(135deg,hsl(var(--card)/0.78),hsl(var(--muted)/0.24))] px-6 py-12 text-center text-muted-foreground shadow-inner shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
            <Search className="h-5 w-5" />
          </div>
          <p className="max-w-md text-sm font-medium">{emptyMessage}</p>
        </div>
      );
    }

    return (
      <div className="space-y-8">
        {INTEGRATION_CATEGORIES.map((category) => {
          const items = list.filter((i) => i.category === category.id);
          if (items.length === 0) return null;

          return (
            <section key={category.id} aria-labelledby={`integration-group-${category.id}`} className="min-w-0 space-y-4">
              <div className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border/50 pb-3">
                <h2
                  id={`integration-group-${category.id}`}
                  className="text-base font-semibold tracking-tight text-foreground sm:text-lg"
                >
                  {category.label}
                </h2>
                <Badge variant="outline" className="rounded-full border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                  {items.length}
                </Badge>
                <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground sm:text-sm">{category.description}</p>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2">
                {items.map(renderIntegrationCard)}
              </div>
            </section>
          );
        })}
      </div>
    );
  };

  return (

    <DashboardThemeFrame
      as="main"
      variant="page"
      className="space-y-5 rounded-[2rem] bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.10),transparent_30%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background)/0.94))] p-3 text-foreground sm:space-y-6 sm:p-5 lg:p-6"
    >
      <DashboardThemeFrame
        as="header"
        variant="hero"
        className="flex min-w-0 flex-col gap-4 border-primary/20 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--background)/0.86)_54%,hsl(var(--muted)/0.34))] shadow-[0_22px_70px_rgba(15,23,42,0.10)] dark:shadow-black/30 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-[0_14px_35px_hsl(var(--primary)/0.16)]">
              <Shield className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Integrations</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                Search, group and configure credentials for every external service this platform connects to
              </p>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={checkSupabaseSecrets}
          disabled={loadingSecrets}
          aria-busy={loadingSecrets}
          aria-label="Refresh Supabase integration secret status"
          className="min-h-[44px] shrink-0 gap-2 self-start rounded-xl border-primary/25 bg-background/70 px-4 font-semibold text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/45 hover:bg-primary/10 hover:text-primary hover:shadow-[0_0_22px_hsl(var(--primary)/0.14)] focus-visible:ring-2 focus-visible:ring-primary/45 disabled:cursor-not-allowed disabled:opacity-65 sm:self-center"
        >
          {loadingSecrets ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Sync Status
        </Button>
      </DashboardThemeFrame>

      <MarketSourceProbePanel />

      {/*
        * The remedy comes from the SERVER, because there are two of them and
        * they are opposites.
        *
        * This banner used to say "add a SUPABASE_ACCESS_TOKEN" whatever had
        * happened. On a clone that is precisely wrong: a Supabase personal
        * access token is scoped to an ACCOUNT and reaches every project this
        * organisation owns, which is why no clone holds one and why the write
        * is brokered through Mission Control instead. Telling a tenant to go
        * and fetch one sends them after the single credential the whole
        * arrangement exists to keep off their project.
        */}
      {supabaseSetupRequired && (
        <Alert className="min-w-0 rounded-2xl border-brand-400/40 bg-brand-500/10 shadow-sm">
          <AlertCircle className="h-4 w-4 text-brand-500" />
          <AlertDescription className="text-sm">
            <span className="font-medium">Credentials cannot be applied yet:</span>{' '}
            {supabaseSetupHint ??
              'This deployment could not say where to write a credential. Check its Mission Control link.'}
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={statusTab} onValueChange={setStatusTab} className="w-full min-w-0">
        <DashboardThemeFrame
          variant="toolbar"
          className="flex min-w-0 flex-col gap-3 rounded-3xl border-primary/15 bg-[linear-gradient(135deg,hsl(var(--card)/0.92),hsl(var(--background)/0.72))] p-3 shadow-xl shadow-sm dark:shadow-black/25"
        >
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-color:hsl(var(--primary)/0.35)_transparent]">
              <TabsList aria-label="Filter integrations by status" className="inline-flex h-auto w-auto min-w-max gap-1 bg-transparent p-0">
                <TabsTrigger value="all" className="rounded-2xl px-4 py-2 text-xs font-semibold transition-all hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/45 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_10px_24px_hsl(var(--primary)/0.22)] sm:text-sm">All</TabsTrigger>
                <TabsTrigger value="configured" className="rounded-2xl px-4 py-2 text-xs font-semibold transition-all hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/45 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_10px_24px_hsl(var(--primary)/0.22)] sm:text-sm">Configured</TabsTrigger>
                <TabsTrigger value="pending" className="rounded-2xl px-4 py-2 text-xs font-semibold transition-all hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/45 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_10px_24px_hsl(var(--primary)/0.22)] sm:text-sm">Pending</TabsTrigger>
                <TabsTrigger value="planned" className="rounded-2xl px-4 py-2 text-xs font-semibold transition-all hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/45 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_10px_24px_hsl(var(--primary)/0.22)] sm:text-sm">Roadmap</TabsTrigger>
              </TabsList>
            </div>

            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search integrations, services or keys…"
              aria-label="Search integrations"
              containerClassName="min-w-0 lg:w-80"
              className="min-h-11 rounded-2xl border-border/70 bg-card/80 pr-3 shadow-inner transition-all placeholder:text-muted-foreground/70 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/35"
            />
          </div>

          {statusTab !== 'planned' && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-t border-border/40 pt-3">
              <span className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                Category
              </span>
              <Button
                type="button"
                size="sm"
                variant={activeCategory === 'all' ? 'default' : 'outline'}
                onClick={() => setActiveCategory('all')}
                aria-pressed={activeCategory === 'all'}
                className="h-8 rounded-full px-3 text-xs font-semibold"
              >
                All ({INTEGRATIONS.length})
              </Button>
              {INTEGRATION_CATEGORIES.map((category) => {
                const count = INTEGRATIONS.filter((i) => i.category === category.id).length;
                const isActive = activeCategory === category.id;
                return (
                  <Button
                    key={category.id}
                    type="button"
                    size="sm"
                    variant={isActive ? 'default' : 'outline'}
                    onClick={() => setActiveCategory(category.id)}
                    aria-pressed={isActive}
                    className="h-8 rounded-full px-3 text-xs font-semibold"
                  >
                    {category.label} ({count})
                  </Button>
                );
              })}
            </div>
          )}
        </DashboardThemeFrame>

        <TabsContent value="all" className="mt-5 sm:mt-6">
          {renderGroupedIntegrations(visibleIntegrations, 'No integrations match your search or category filter.')}
        </TabsContent>

        <TabsContent value="configured" className="mt-5 sm:mt-6">
          {renderGroupedIntegrations(
            visibleIntegrations.filter((i) => getIntegrationStatus(i) === 'configured'),
            'No integrations have been fully configured yet.',
          )}
        </TabsContent>

        <TabsContent value="pending" className="mt-5 sm:mt-6">
          {renderGroupedIntegrations(
            visibleIntegrations.filter((i) => getIntegrationStatus(i) !== 'configured'),
            'Every matching integration is fully configured.',
          )}
        </TabsContent>


        {/* Planned Integrations Roadmap */}
        <TabsContent value="planned" className="mt-5 sm:mt-6">
          <PlannedIntegrations />
        </TabsContent>
      </Tabs>
    </DashboardThemeFrame>
  );
}
