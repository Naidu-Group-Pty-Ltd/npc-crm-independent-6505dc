import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Link2, Copy, X, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface ShareLinksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  template: ReportTemplate;
  currentUserId?: string | null;
}

type Row = {
  id: string;
  token: string;
  label: string | null;
  mode: string;
  theme_id: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
};

const TTL_OPTIONS = [
  { value: '0', label: 'Never expires' },
  { value: '1', label: '1 day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

function randomToken(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 32);
}

function shareUrl(token: string): string {
  return `${window.location.origin}/template-share/${token}`;
}

export function ShareLinksDialog({ open, onOpenChange, templateId, template, currentUserId }: ShareLinksDialogProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<'preview' | 'final'>('preview');
  const [themeId, setThemeId] = useState<string>('__active__');
  const [ttl, setTtl] = useState('30');

  const themes = Object.entries(template.themes ?? {});

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('template_share_links')
      .select('id, token, label, mode, theme_id, expires_at, revoked_at, view_count, last_viewed_at, created_at')
      .eq('template_id', templateId)
      .order('created_at', { ascending: false });
    if (!error && data) setRows(data as Row[]);
    setLoading(false);
  };

  useEffect(() => { if (open) load(); }, [open, templateId]);

  const create = async () => {
    setCreating(true);
    try {
      const token = randomToken();
      const days = Number(ttl);
      const expires = days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null;
      const { error } = await supabase.from('template_share_links').insert({
        template_id: templateId,
        token,
        label: label.trim() || null,
        mode,
        theme_id: themeId === '__active__' ? (template.activeThemeId ?? null) : themeId,
        expires_at: expires,
        created_by: currentUserId ?? null,
      });
      if (error) throw error;
      await navigator.clipboard.writeText(shareUrl(token)).catch(() => {});
      toast.success('Share link created and copied');
      setLabel('');
      await load();
    } catch (e: any) {
      toast.error(`Failed: ${e?.message ?? e}`);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    await supabase.from('template_share_links').update({ revoked_at: new Date().toISOString() }).eq('id', id);
    await load();
  };

  const status = (r: Row): { label: string; color: string } => {
    if (r.revoked_at) return { label: 'Revoked', color: 'destructive' };
    if (r.expires_at && new Date(r.expires_at).getTime() < Date.now()) return { label: 'Expired', color: 'secondary' };
    return { label: 'Active', color: 'default' };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" /> Share Links
          </DialogTitle>
          <DialogDescription>
            Create tokenised read-only previews. Stakeholders can open the link in any browser without signing in.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6">
          <div className="space-y-6 py-4">
            <section className="rounded-lg border bg-card p-4 space-y-3">
              <h3 className="text-sm font-semibold">Create new link</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2">
                  <Label>Label (optional)</Label>
                  <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Acme Pty Ltd review" />
                </div>
                <div className="space-y-1">
                  <Label>Mode</Label>
                  <Select value={mode} onValueChange={(v) => setMode(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="preview">Preview (watermarked)</SelectItem>
                      <SelectItem value="final">Final</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Theme override</Label>
                  <Select value={themeId} onValueChange={setThemeId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__active__">Active ({template.activeThemeId || 'default'})</SelectItem>
                      {themes.map(([k, t]: any) => (
                        <SelectItem key={k} value={k}>{t?.name || k}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Expires</Label>
                  <Select value={ttl} onValueChange={setTtl}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TTL_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button onClick={create} disabled={creating} className="w-full">
                    {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
                    Generate & copy
                  </Button>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Existing links</h3>
                <Button size="sm" variant="ghost" onClick={load}>
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </Button>
              </div>
              {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No share links yet.</p>
              ) : (
                <ul className="space-y-2">
                  {rows.map(r => {
                    const s = status(r);
                    const url = shareUrl(r.token);
                    return (
                      <li key={r.id} className="rounded border p-3 text-xs space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{r.label || `Untitled · ${r.mode}`}</div>
                            <div className="text-muted-foreground">
                              <Badge variant={s.color as any} className="text-[10px] px-1">{s.label}</Badge>
                              {' · '}
                              <Badge variant="outline" className="text-[10px] px-1">{r.mode}</Badge>
                              {' · '}views: {r.view_count}
                              {r.last_viewed_at && ` · last ${formatDistanceToNow(new Date(r.last_viewed_at), { addSuffix: true })}`}
                              {' · created '}{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                              {r.expires_at && ` · expires ${formatDistanceToNow(new Date(r.expires_at), { addSuffix: true })}`}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button size="sm" variant="outline" onClick={() => {
                              navigator.clipboard.writeText(url).then(() => toast.success('Link copied'));
                            }}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="outline" asChild>
                              <a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
                            </Button>
                            {!r.revoked_at && (
                              <Button size="sm" variant="ghost" onClick={() => revoke(r.id)} title="Revoke">
                                <X className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <code className="block text-[10px] text-muted-foreground break-all">{url}</code>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 pb-6 pt-3 border-t">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
