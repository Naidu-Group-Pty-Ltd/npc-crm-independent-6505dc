import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthenticatedSupabase } from '@/hooks/useAuthenticatedSupabase';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Plus, Pencil, Trash2, Star, StarOff, Loader2, X, FileSignature, Sparkles, Layers3, AlertCircle, ArrowRight, ShieldCheck, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

interface PlaceholderMapping {
  placeholder: string;
  field: string;
  defaultValue?: string;
}

interface GammaTemplate {
  id: string;
  name: string;
  gamma_template_id: string;
  description: string | null;
  placeholder_mappings: PlaceholderMapping[];
  is_default: boolean;
  is_active: boolean;
  created_at: string;
}

const AVAILABLE_FIELDS = [
  { value: 'buyer_names', label: "Buyer's Name" },
  { value: 'buyer_address', label: 'Address' },
  { value: 'buyer_phone', label: 'Phone Number' },
  { value: 'buyer_email', label: 'Email' },
  { value: 'initial_commitment_fee', label: 'Initial Commitment Fee' },
  { value: 'secondary_buyer_name', label: 'Secondary Buyer Name' },
  { value: 'agreement_date', label: 'Agreement Date' },
  { value: 'notes', label: 'Notes' },
];

function useGammaTemplates() {
  const { supabase } = useAuthenticatedSupabase();
  return useQuery({
    queryKey: ['gamma-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gamma_agreement_templates' as any)
        .select('*')
        .order('is_default', { ascending: false })
        .order('name');
      if (error) throw error;
      return (data || []) as unknown as GammaTemplate[];
    },
  });
}

export default function GammaTemplateManager() {
  const queryClient = useQueryClient();
  // Staff-JWT client so gamma_agreement_templates can drop its anon grants (RLS-W2).
  const { supabase } = useAuthenticatedSupabase();
  const { data: templates = [], isLoading, isError, error, refetch } = useGammaTemplates();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<GammaTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GammaTemplate | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [gammaId, setGammaId] = useState('');
  const [description, setDescription] = useState('');
  const [mappings, setMappings] = useState<PlaceholderMapping[]>([
    { placeholder: "[Buyer's Name]", field: 'buyer_names' },
    { placeholder: '[Address]', field: 'buyer_address' },
    { placeholder: '[Phone Number]', field: 'buyer_phone' },
    { placeholder: '[Email]', field: 'buyer_email' },
    { placeholder: '[Initial Commitment Fee]', field: 'initial_commitment_fee', defaultValue: '$1,500.00 + GST' },
  ]);

  const resetForm = () => {
    setName('');
    setGammaId('');
    setDescription('');
    setMappings([
      { placeholder: "[Buyer's Name]", field: 'buyer_names' },
      { placeholder: '[Address]', field: 'buyer_address' },
      { placeholder: '[Phone Number]', field: 'buyer_phone' },
      { placeholder: '[Email]', field: 'buyer_email' },
      { placeholder: '[Initial Commitment Fee]', field: 'initial_commitment_fee', defaultValue: '$1,500.00 + GST' },
    ]);
    setEditingTemplate(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (t: GammaTemplate) => {
    setEditingTemplate(t);
    setName(t.name);
    setGammaId(t.gamma_template_id);
    setDescription(t.description || '');
    setMappings(t.placeholder_mappings.length > 0 ? t.placeholder_mappings : [{ placeholder: '', field: '' }]);
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        gamma_template_id: gammaId,
        description: description || null,
        placeholder_mappings: mappings.filter(m => m.placeholder && m.field),
      };
      if (editingTemplate) {
        const { error } = await supabase
          .from('gamma_agreement_templates' as any)
          .update(payload as any)
          .eq('id', editingTemplate.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('gamma_agreement_templates' as any)
          .insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gamma-templates'] });
      toast.success(editingTemplate ? 'Template updated' : 'Template created');
      setDialogOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('gamma_agreement_templates' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gamma-templates'] });
      toast.success('Template deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Make one template the default.
   *
   * Three things were wrong with this, and the 19 Sep 2026 clone audit saw the
   * third: "set to default does not work in real time, page has to be
   * refreshed for action to be implemented".
   *
   * **The clearing write's error was discarded.** `await supabase…update({
   * is_default: false })` with no `error` check: refused by RLS, it left the
   * old default standing while the new one was also set, so the table held two
   * defaults and nothing said so.
   *
   * **The order left a gap with no default at all.** Clearing first and then
   * setting means any failure of the second write — or a reload in between —
   * leaves the blueprint unset. Setting first and clearing after leaves two
   * defaults in the same fault, which is recoverable by clicking again.
   *
   * **The toast fired before the list was re-read.** `invalidateQueries`
   * returns a promise and it was not awaited, so "Default template updated"
   * appeared over the old list; when the refetch then failed (which is exactly
   * what this panel does on a deployment where the read is refused), nothing
   * reported it and only a page reload showed the truth.
   */
  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error: setError } = await supabase
        .from('gamma_agreement_templates' as any)
        .update({ is_default: true } as any)
        .eq('id', id);
      if (setError) throw setError;

      const { error: clearError } = await supabase
        .from('gamma_agreement_templates' as any)
        .update({ is_default: false } as any)
        .neq('id', id);
      if (clearError) throw clearError;
    },
    onSuccess: async () => {
      // Awaited, so the toast describes a list that has actually been re-read.
      await queryClient.invalidateQueries({ queryKey: ['gamma-templates'] });
      toast.success('Default template updated');
    },
    onError: (e: Error) => toast.error(e.message || 'Could not set the default template'),
  });

  const addMapping = () => setMappings([...mappings, { placeholder: '', field: '' }]);
  const removeMapping = (idx: number) => setMappings(mappings.filter((_, i) => i !== idx));
  const updateMapping = (idx: number, key: keyof PlaceholderMapping, value: string) => {
    const updated = [...mappings];
    updated[idx] = { ...updated[idx], [key]: value };
    setMappings(updated);
  };

  return (
    <DashboardThemeFrame
      as="section"
      variant="section"
      className="flex min-h-0 flex-col overflow-hidden border-border/80 bg-[radial-gradient(circle_at_top_left,hsl(43_84%_52%/0.14),transparent_30%),radial-gradient(circle_at_bottom_right,hsl(var(--primary)/0.08),transparent_28%),linear-gradient(180deg,hsl(var(--card)/0.99),hsl(var(--background)/0.94))] p-0 shadow-[0_26px_80px_rgba(15,23,42,0.12)] ring-1 ring-border dark:ring-white/55 dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.14),transparent_32%),radial-gradient(circle_at_bottom_right,hsl(var(--primary)/0.10),transparent_30%),linear-gradient(180deg,rgba(15,23,42,0.88),rgba(2,6,23,0.72))] dark:ring-white/10"
    >
      <CardHeader className="border-b border-border/70 bg-muted/35 pb-5 backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-brand-300/35 bg-[linear-gradient(135deg,hsl(43_84%_52%/0.20),hsl(var(--primary)/0.10))] text-brand-600 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.55),0_12px_30px_hsl(43_84%_52%/0.16)] dark:border-brand-200/20 dark:text-brand-200 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_18px_42px_rgba(0,0,0,0.32)]">
                <FileSignature className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-brand-600/90 dark:text-brand-200/80">Agreement blueprints</p>
                <CardTitle className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Gamma Templates</CardTitle>
              </div>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Manage reusable Gamma agreement templates, safe placeholder mapping, and the default agreement blueprint used for client sends.</p>
          </div>
          <Button size="sm" onClick={openCreate} className="h-12 w-full rounded-2xl sm:w-auto bg-[linear-gradient(135deg,hsl(48_96%_89%),hsl(43_84%_52%)_48%,hsl(38_92%_50%))] px-4 font-semibold text-foreground shadow-[0_14px_34px_hsl(43_84%_52%/0.28),inset_0_1px_0_rgba(255,255,255,0.55)] transition-all hover:translate-y-[-1px] hover:shadow-[0_18px_42px_hsl(43_84%_52%/0.38),0_0_0_1px_hsl(43_84%_52%/0.22),inset_0_1px_0_rgba(255,255,255,0.65)] focus-visible:ring-2 focus-visible:ring-brand-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:text-foreground">
            <Plus className="mr-2 h-4 w-4" /> Add Template
          </Button>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 p-3 sm:p-5">
        {isLoading ? (
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-[radial-gradient(circle_at_top,hsl(43_84%_52%/0.12),transparent_36%),linear-gradient(180deg,hsl(var(--card)/0.96),hsl(var(--background)/0.84))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.60),0_16px_42px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.12),transparent_40%),linear-gradient(180deg,rgba(15,23,42,0.78),rgba(2,6,23,0.56))]">
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-brand-300/35 bg-brand-500/10 text-brand-700 dark:text-brand-100">
                <Loader2 className="h-5 w-5 animate-spin" />
              </span>
              <div>
                <p className="text-sm font-bold text-foreground">Loading Gamma templates</p>
                <p className="text-xs leading-5 text-muted-foreground">Checking saved template blueprints and placeholder mappings.</p>
              </div>
            </div>
            <div className="space-y-3" aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <div key={row} className="grid gap-3 rounded-2xl border border-border/55 bg-card/70 p-4 dark:border-white/10 dark:bg-background/35 sm:grid-cols-[1.4fr_1fr_0.8fr_0.8fr]">
                  <div className="space-y-2"><div className="h-4 w-3/4 animate-pulse rounded-full bg-muted" /><div className="h-3 w-1/2 animate-pulse rounded-full bg-muted/70" /></div>
                  <div className="h-8 animate-pulse rounded-xl bg-muted/80" />
                  <div className="h-8 animate-pulse rounded-xl bg-muted/80" />
                  <div className="h-8 animate-pulse rounded-xl bg-muted/80" />
                </div>
              ))}
            </div>
          </div>
        ) : isError ? (
          <div className="mx-4 my-5 rounded-2xl border border-destructive/35 bg-[radial-gradient(circle_at_top,hsl(var(--destructive)/0.08),transparent_38%),linear-gradient(180deg,hsl(var(--card)/0.96),hsl(var(--background)/0.88))] px-5 py-10 text-center shadow-sm dark:border-destructive/25 dark:bg-[radial-gradient(circle_at_top,rgba(248,113,113,0.10),transparent_42%),linear-gradient(180deg,rgba(15,23,42,0.78),rgba(2,6,23,0.56))]">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-destructive/40 bg-destructive/10 text-destructive dark:border-destructive/25 dark:text-destructive">
              <AlertCircle className="h-5 w-5" />
            </div>
            <p className="text-base font-semibold text-foreground">Unable to load Gamma templates.</p>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{error instanceof Error ? error.message : 'Please try again. Template data and save logic are unchanged.'}</p>
            <Button variant="outline" className="mt-5 rounded-xl border-destructive/35 bg-background/80 text-foreground hover:bg-destructive/10" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry loading templates
            </Button>
          </div>
        ) : templates.length === 0 ? (
          <div className="mx-4 my-5 overflow-hidden rounded-2xl border border-dashed border-brand-300/45 bg-[radial-gradient(circle_at_top,hsl(43_84%_52%/0.12),transparent_38%),linear-gradient(180deg,hsl(var(--card)/0.94),hsl(var(--muted)/0.28))] px-5 py-10 text-center text-sm text-muted-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.36),0_16px_42px_rgba(15,23,42,0.08)] dark:border-brand-200/25 dark:bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.10),transparent_42%),linear-gradient(180deg,rgba(15,23,42,0.78),rgba(2,6,23,0.48))]">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-300/40 bg-brand-400/12 text-brand-700 shadow-[0_14px_34px_hsl(43_84%_32%/0.14)] dark:border-brand-200/25 dark:bg-brand-200/10 dark:text-brand-100">
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="text-base font-semibold text-foreground">No templates configured.</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted-foreground">Add a Gamma template to get started with reusable agreement blueprints.</p>
          </div>
        ) : (
          <div className="max-h-[min(46dvh,34rem)] min-h-[16rem] overflow-auto overscroll-contain rounded-2xl border border-border/80 bg-card/95 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.58),0_18px_46px_rgba(15,23,42,0.08)] [scrollbar-color:hsl(var(--primary)/0.38)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-primary/35 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent dark:border-white/10 dark:bg-background/45 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_22px_52px_rgba(0,0,0,0.28)]">
            <Table aria-label="Gamma agreement templates" className="min-w-[820px]">
            <TableHeader className="bg-muted/85 shadow-[0_1px_0_hsl(var(--border)/0.85)] dark:bg-white/[0.04]">
              <TableRow>
                <TableHead className="h-12 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-muted-foreground">Name</TableHead>
                <TableHead className="h-12 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-muted-foreground">Gamma ID</TableHead>
                <TableHead className="h-12 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-muted-foreground">Placeholders</TableHead>
                <TableHead className="h-12 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-muted-foreground">Status</TableHead>
                <TableHead className="h-12 w-32 text-right text-[0.68rem] font-bold uppercase tracking-[0.18em] text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id} className="group border-border/60 bg-card/40 transition-all duration-200 hover:bg-[linear-gradient(90deg,hsl(43_84%_52%/0.14),hsl(var(--card)/0.88))] hover:shadow-[inset_3px_0_0_hsl(43_84%_52%/0.75)] dark:border-white/10 dark:hover:bg-[linear-gradient(90deg,rgba(251,191,36,0.09),rgba(15,23,42,0.28))] dark:hover:shadow-[inset_3px_0_0_rgba(251,191,36,0.72)]">
                  <TableCell className="py-4">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-sm font-bold tracking-[-0.01em] text-foreground transition-colors group-hover:text-brand-700 sm:text-base dark:group-hover:text-brand-100">{t.name}</span>
                    {t.is_default && (
                      <Badge variant="default" className="gap-1 rounded-full border border-brand-200/70 bg-[linear-gradient(135deg,hsl(48_96%_89%),hsl(43_84%_52%)_48%,hsl(35_92%_48%))] px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.12em] text-foreground shadow-[0_10px_24px_hsl(43_84%_52%/0.28),inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-brand-100/35 dark:shadow-[0_10px_28px_rgba(251,191,36,0.18),inset_0_1px_0_rgba(255,255,255,0.35)]"><Sparkles className="h-3 w-3 fill-foreground/20" />Default</Badge>
                    )}
                    </div>
                    {t.description && <p className="mt-1 max-w-md truncate text-xs text-muted-foreground">{t.description}</p>}
                  </TableCell>
                  <TableCell className="py-4">
                    <code className="inline-flex max-w-[15rem] items-center rounded-xl border border-border/70 bg-muted/45 px-3 py-1.5 font-mono text-[0.70rem] font-medium text-muted-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.45)] transition-colors group-hover:border-brand-300/45 group-hover:bg-brand-50/60 group-hover:text-brand-900 dark:border-white/10 dark:bg-white/[0.05] dark:text-foreground/80 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] dark:group-hover:border-brand-200/25 dark:group-hover:bg-brand-200/10 dark:group-hover:text-brand-50" title={t.gamma_template_id}>
                      <span className="truncate">{t.gamma_template_id}</span>
                    </code>
                  </TableCell>
                  <TableCell className="py-4">
                    <Badge variant="secondary" className="gap-1.5 rounded-full border border-border/70 bg-muted px-2.5 py-1 text-xs font-bold text-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.42)] dark:border-white/10 dark:bg-background/70 dark:text-foreground">
                      <Layers3 className="h-3 w-3" />
                      {t.placeholder_mappings.length} {t.placeholder_mappings.length === 1 ? 'mapping' : 'mappings'}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-4">
                    <Badge variant={t.is_active ? 'outline' : 'secondary'} className={t.is_active ? 'rounded-full border-success/45 bg-[linear-gradient(135deg,rgba(20,184,166,0.14),rgba(16,185,129,0.10))] px-2.5 py-1 text-xs font-bold text-success shadow-[inset_0_1px_0_hsl(0_0%_100%/0.44),0_8px_18px_rgba(20,184,166,0.10)] dark:border-success/25 dark:bg-success/10 dark:text-success' : 'rounded-full border border-border/70 bg-muted px-2.5 py-1 text-xs font-semibold text-foreground dark:border-white/10 dark:text-foreground'}>
                      <span className={t.is_active ? 'mr-1.5 h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_0_3px_rgba(16,185,129,0.14)]' : 'mr-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/60'} />
                      {t.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-4">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="icon" aria-label={t.is_default ? "Default template" : `Set ${t.name} as default template`} className="h-11 w-11 rounded-xl border border-transparent text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-brand-300/45 hover:bg-brand-500/10 hover:text-brand-700 hover:shadow-[0_8px_18px_hsl(43_84%_52%/0.16)] focus-visible:border-brand-400/60 focus-visible:ring-2 focus-visible:ring-brand-300/45 dark:hover:border-brand-200/25 dark:hover:text-brand-200" onClick={() => setDefaultMutation.mutate(t.id)} title="Set as default">
                        {t.is_default ? <Star className="h-4 w-4 fill-brand-400 text-brand-500 drop-shadow-[0_0_7px_rgba(245,158,11,0.45)]" /> : <StarOff className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Edit ${t.name} template`} className="h-11 w-11 rounded-xl border border-transparent text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-brand-300/45 hover:bg-brand-500/10 hover:text-brand-700 hover:shadow-[0_8px_18px_hsl(43_84%_52%/0.16)] focus-visible:border-brand-400/60 focus-visible:ring-2 focus-visible:ring-brand-300/45 dark:hover:border-brand-200/25 dark:hover:text-brand-200" onClick={() => openEdit(t)} title="Edit template">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Delete ${t.name} template`} className="h-11 w-11 rounded-xl border border-transparent text-destructive/80 transition-all hover:-translate-y-0.5 hover:border-destructive/25 hover:bg-destructive/10 hover:text-destructive hover:shadow-[0_8px_18px_hsl(var(--destructive)/0.12)] focus-visible:border-destructive/40 focus-visible:ring-2 focus-visible:ring-destructive/25" title="Delete template" onClick={() => setDeleteTarget(t)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </CardContent>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); resetForm(); } }}>
        <DialogContent aria-describedby={undefined} className="flex max-h-[min(92dvh,900px)] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-0 overflow-hidden rounded-[2rem] sm:max-h-[min(88dvh,900px)] sm:w-[calc(100vw-2rem)] sm:max-w-4xl sm:p-0 border border-brand-300/50 bg-[radial-gradient(circle_at_top_left,hsl(43_84%_52%/0.18),transparent_34%),radial-gradient(circle_at_bottom_right,hsl(221_83%_53%/0.08),transparent_28%),linear-gradient(180deg,hsl(var(--card)),hsl(var(--background)/0.97))] p-0 text-card-foreground shadow-[0_34px_110px_rgba(15,23,42,0.30)] ring-1 ring-border dark:ring-white/70 dark:border-brand-200/15 dark:bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.18),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.12),transparent_30%),linear-gradient(180deg,rgba(15,23,42,0.99),rgba(2,6,23,0.97))] dark:ring-white/10">
          <div className="flex min-h-0 flex-1 flex-col">
            <DialogHeader className="border-b border-border/70 bg-muted/45 px-6 py-5 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04] sm:px-7">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-brand-300/45 bg-[linear-gradient(135deg,hsl(43_84%_52%/0.24),hsl(38_92%_50%/0.12))] text-brand-600 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.68),0_16px_34px_hsl(43_84%_52%/0.18)] dark:border-brand-200/20 dark:text-brand-200 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_42px_rgba(0,0,0,0.34)]">
                  <Sparkles className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[0.68rem] font-bold uppercase tracking-[0.28em] text-brand-600/90 dark:text-brand-200/80">Template workflow</p>
                  <DialogTitle className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{editingTemplate ? 'Edit Template' : 'Add Gamma Template'}</DialogTitle>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Configure the Gamma source, merge fields, and fallback values used when agreement documents are created. Existing edit values are shown exactly as saved.
                  </p>
                </div>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 [scrollbar-color:hsl(var(--primary)/0.38)_transparent] [scrollbar-width:thin] sm:px-7">
              <div className="space-y-5">
                {editingTemplate && (
                  <div className="rounded-2xl border border-brand-300/35 bg-brand-500/10 px-4 py-3 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.48)] dark:border-brand-200/20 dark:bg-brand-200/10">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-200" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">Editing saved template values</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">Review the existing Gamma ID and mappings before saving. Long IDs and placeholders wrap below to keep the workflow controlled.</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="w-fit rounded-full border-brand-300/45 bg-background/70 px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-brand-700 dark:border-brand-200/20 dark:bg-background/45 dark:text-brand-200">
                        {mappings.filter((m) => m.placeholder && m.field).length} active mappings
                      </Badge>
                    </div>
                  </div>
                )}
                <section className="rounded-3xl border border-border/75 bg-card/88 p-4 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.56),0_16px_42px_rgba(15,23,42,0.07)] dark:border-white/10 dark:bg-white/[0.045] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-foreground">Template details</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">Name the workflow and paste the exact Gamma template identifier.</p>
                    </div>
                    <Badge variant="outline" className="rounded-full border-brand-300/45 bg-brand-500/10 px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-brand-700 dark:border-brand-200/20 dark:text-brand-200">Required</Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="gamma-template-name" className="text-xs font-bold uppercase tracking-[0.14em] text-foreground/80">Template Name</Label>
                      <Input id="gamma-template-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Buyer's Agent Agreement v2" className="h-11 rounded-xl border-border/70 bg-background/85 shadow-sm transition-all placeholder:text-muted-foreground/65 focus-visible:border-brand-400 focus-visible:ring-2 focus-visible:ring-brand-300/45 dark:border-white/10 dark:bg-background/55 dark:focus-visible:border-brand-300/70" />
                      {!name && <p className="text-xs font-medium text-muted-foreground">Enter a recognizable name for admins and agreement senders.</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="gamma-template-id" className="text-xs font-bold uppercase tracking-[0.14em] text-foreground/80">Gamma Template ID</Label>
                      <Input id="gamma-template-id" value={gammaId} onChange={(e) => setGammaId(e.target.value)} placeholder="e.g. g_abc123xyz" className="h-11 rounded-xl border-border/70 bg-background/85 font-mono text-sm shadow-sm transition-all placeholder:text-muted-foreground/65 focus-visible:border-brand-400 focus-visible:ring-2 focus-visible:ring-brand-300/45 dark:border-white/10 dark:bg-background/55 dark:focus-visible:border-brand-300/70 [overflow-wrap:anywhere]" />
                      {!gammaId && <p className="text-xs font-medium text-muted-foreground">Use the Gamma ID already connected to the agreement automation.</p>}
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    <Label htmlFor="gamma-template-description" className="text-xs font-bold uppercase tracking-[0.14em] text-foreground/80">Description (optional)</Label>
                    <Textarea id="gamma-template-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of this template..." rows={2} className="rounded-xl border-border/70 bg-background/85 shadow-sm transition-all placeholder:text-muted-foreground/65 focus-visible:border-brand-400 focus-visible:ring-2 focus-visible:ring-brand-300/45 dark:border-white/10 dark:bg-background/55 dark:focus-visible:border-brand-300/70" />
                  </div>
                </section>

                <section className="rounded-3xl border border-border/75 bg-card/88 p-4 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.56),0_16px_42px_rgba(15,23,42,0.07)] dark:border-white/10 dark:bg-white/[0.045] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-foreground">Placeholder Mappings</h3>
                      <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">Map placeholders in your Gamma template (e.g. [Buyer's Name]) to agreement data fields. Optional defaults are used only when a mapped value is unavailable.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={addMapping} className="shrink-0 rounded-xl border-brand-300/45 bg-brand-500/10 font-semibold text-brand-700 transition-all hover:-translate-y-0.5 hover:bg-brand-500/15 hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-300/45 dark:border-brand-200/20 dark:text-brand-200 dark:hover:bg-brand-200/10 dark:hover:text-brand-100">
                      <Plus className="mr-1 h-3 w-3" /> Add Mapping
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {mappings.map((m, idx) => (
                      <div key={idx} className="grid gap-3 rounded-2xl border border-border/70 bg-card/80 p-3 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.44),0_12px_30px_rgba(15,23,42,0.05)] transition-all hover:border-brand-300/40 hover:bg-brand-500/[0.06] dark:border-white/10 dark:bg-background/35 dark:hover:border-brand-200/20 dark:hover:bg-brand-200/[0.07] lg:grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1.3fr)_minmax(0,1.8fr)_auto] lg:items-end">
                        <div className="min-w-0 space-y-1.5">
                          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Gamma placeholder</Label>
                          <Input
                            value={m.placeholder}
                            onChange={(e) => updateMapping(idx, 'placeholder', e.target.value)}
                            placeholder="[Placeholder]"
                            className="min-h-11 w-full rounded-xl border-border/70 bg-background/90 text-sm shadow-sm transition-all focus-visible:border-brand-400 focus-visible:ring-2 focus-visible:ring-brand-300/45 dark:border-white/10 dark:bg-background/65 [overflow-wrap:anywhere]"
                          />
                        </div>
                        <span className="hidden pb-3 text-brand-500 lg:block"><ArrowRight className="h-5 w-5" /></span>
                        <div className="min-w-0 space-y-1.5">
                          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agreement field</Label>
                          <select
                            value={m.field}
                            onChange={(e) => updateMapping(idx, 'field', e.target.value)}
                            className="min-h-11 w-full rounded-xl border border-input bg-background/90 px-3 text-sm shadow-sm transition-all hover:border-brand-300/45 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-300/45 dark:border-white/10 dark:bg-background/65 dark:hover:border-brand-200/25"
                          >
                            <option value="">Select field...</option>
                            {AVAILABLE_FIELDS.map((f) => (
                              <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="min-w-0 space-y-1.5">
                          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Default</Label>
                          <Input
                            value={m.defaultValue || ''}
                            onChange={(e) => updateMapping(idx, 'defaultValue', e.target.value)}
                            placeholder="Optional default"
                            className="min-h-11 w-full rounded-xl border-border/70 bg-background/90 text-sm shadow-sm transition-all focus-visible:border-brand-400 focus-visible:ring-2 focus-visible:ring-brand-300/45 dark:border-white/10 dark:bg-background/65"
                          />
                        </div>

                        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-xl border border-transparent text-muted-foreground transition-all hover:border-destructive/25 hover:bg-destructive/10 hover:text-destructive focus-visible:border-destructive/35 focus-visible:ring-2 focus-visible:ring-destructive/25" onClick={() => removeMapping(idx)} aria-label="Remove placeholder mapping">
                          <X className="h-4 w-4" />
                        </Button>
                        <div className="min-w-0 rounded-xl border border-border/65 bg-background/85 px-3 py-2 text-[0.72rem] leading-5 text-muted-foreground dark:border-white/10 dark:bg-white/[0.035] lg:col-span-5">
                          <span className="font-semibold text-foreground">Preview:</span>{' '}
                          <code className="font-mono text-foreground/80 [overflow-wrap:anywhere]">{m.placeholder || '[Placeholder]'}</code>
                          <span className="mx-2 text-brand-500">→</span>
                          <span className="font-medium text-foreground/80">{AVAILABLE_FIELDS.find((f) => f.value === m.field)?.label || 'Select field...'}</span>
                          {m.defaultValue && <span className="ml-2 [overflow-wrap:anywhere]">Fallback: {m.defaultValue}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>

            <DialogFooter className="flex-col gap-3 border-t border-border/70 bg-muted/45 px-6 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                {(!name || !gammaId) ? <AlertCircle className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-200" /> : <ShieldCheck className="h-4 w-4 shrink-0 text-success dark:text-success" />}
                <span>{(!name || !gammaId) ? 'Template name and Gamma template ID are required before saving.' : 'Ready to save with the existing update workflow.'}</span>
              </div>
              <div className="flex w-full justify-end gap-2 sm:w-auto">
              <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }} className="h-11 rounded-xl border-border/75 bg-background/75 px-5 font-semibold text-muted-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand-300/45 dark:border-white/10 dark:bg-background/45 dark:hover:border-white/20">Cancel</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!name || !gammaId || saveMutation.isPending} aria-busy={saveMutation.isPending} className="h-11 rounded-xl bg-[linear-gradient(135deg,hsl(48_96%_89%),hsl(43_84%_52%)_42%,hsl(38_92%_50%))] px-6 font-black text-foreground shadow-[0_16px_38px_hsl(43_84%_52%/0.34),inset_0_1px_0_rgba(255,255,255,0.55)] transition-all hover:-translate-y-0.5 hover:shadow-[0_20px_48px_hsl(43_84%_52%/0.42),inset_0_1px_0_rgba(255,255,255,0.65)] focus-visible:ring-2 focus-visible:ring-brand-300/60 disabled:translate-y-0 disabled:opacity-55 dark:text-foreground">
                {saveMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {saveMutation.isPending ? (editingTemplate ? 'Saving changes...' : 'Creating template...') : (editingTemplate ? 'Save Changes' : 'Create Template')}
              </Button>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-2xl border-border/80 bg-[linear-gradient(180deg,hsl(var(--card)),hsl(var(--background)/0.96))] p-5 shadow-[0_28px_90px_rgba(15,23,42,0.26)] ring-1 ring-border dark:ring-white/70 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.96))] dark:ring-white/10 sm:p-6">
          <AlertDialogHeader>
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive">
              <Trash2 className="h-5 w-5" />
            </div>
            <AlertDialogTitle className="text-xl font-semibold tracking-[-0.02em] text-foreground">Delete template?</AlertDialogTitle>
            <AlertDialogDescription className="leading-6">
              This will delete {deleteTarget?.name ? `"${deleteTarget.name}"` : 'this template'}. Existing agreement data and rows are not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="min-h-11 rounded-xl border-border/75 bg-background/75 font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 rounded-xl bg-destructive font-semibold text-destructive-foreground shadow-[0_14px_34px_hsl(var(--destructive)/0.22)] hover:bg-destructive/90 focus-visible:ring-2 focus-visible:ring-destructive/30"
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardThemeFrame>
  );
}
