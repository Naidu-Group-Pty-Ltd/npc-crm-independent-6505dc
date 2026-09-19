import { useState } from 'react';
import { AlertTriangle, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatCurrency, formatMatterDate } from '@/lib/legalMatters';
import {
  SEARCH_STATUS_CLASSES, SEARCH_STATUS_LABELS, SEARCH_STATUS_OPTIONS,
  SEARCH_TYPE_LABELS, SEARCH_TYPE_OPTIONS,
  type LegalMatterSearch, type LegalSearchStatus, type LegalSearchType,
} from '@/lib/legalDocuments';

export interface SearchDraft {
  id: string | null;
  search_type: LegalSearchType;
  label: string;
  provider: string;
  reference: string;
  status: LegalSearchStatus;
  ordered_at: string;
  received_at: string;
  due_date: string;
  cost_amount: string;
  issue_flag: boolean;
  result_summary: string;
  notes: string;
  visible_to_client: boolean;
}

const EMPTY_SEARCH: SearchDraft = {
  id: null,
  search_type: 'title_search',
  label: '',
  provider: '',
  reference: '',
  status: 'not_ordered',
  ordered_at: '',
  received_at: '',
  due_date: '',
  cost_amount: '',
  issue_flag: false,
  result_summary: '',
  notes: '',
  visible_to_client: false,
};

export interface MatterSearchesPanelProps {
  searches: LegalMatterSearch[];
  canEdit: boolean;
  canDelete: boolean;
  saving?: boolean;
  onSave: (draft: SearchDraft) => Promise<void> | void;
  onSetStatus: (searchId: string, status: LegalSearchStatus) => Promise<void> | void;
  onDelete: (searchId: string) => Promise<void> | void;
}

export function MatterSearchesPanel({
  searches, canEdit, canDelete, saving, onSave, onSetStatus, onDelete,
}: MatterSearchesPanelProps) {
  const [draft, setDraft] = useState<SearchDraft | null>(null);

  const openEdit = (s?: LegalMatterSearch) => {
    setDraft(s
      ? {
          id: s.id,
          search_type: s.search_type,
          label: s.label,
          provider: s.provider ?? '',
          reference: s.reference ?? '',
          status: s.status,
          ordered_at: (s.ordered_at ?? '').slice(0, 10),
          received_at: (s.received_at ?? '').slice(0, 10),
          due_date: (s.due_date ?? '').slice(0, 10),
          cost_amount: s.cost_amount != null ? String(s.cost_amount) : '',
          issue_flag: s.issue_flag,
          result_summary: s.result_summary ?? '',
          notes: s.notes ?? '',
          visible_to_client: s.visible_to_client,
        }
      : {
          ...EMPTY_SEARCH,
          label: SEARCH_TYPE_LABELS.title_search,
        });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Searches register</CardTitle>
          <CardDescription>
            Title, council, water and statutory searches ordered for this matter.
          </CardDescription>
        </div>
        {canEdit ? (
          <Button size="sm" onClick={() => openEdit()}>
            <Plus className="mr-2 h-4 w-4" /> Add search
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {searches.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No searches recorded. Add the title search to start the register.
          </p>
        ) : null}

        {searches.map((s) => (
          <div
            key={s.id}
            className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{s.label}</span>
                <Badge variant="outline" className={cn('text-xs', SEARCH_STATUS_CLASSES[s.status])}>
                  {SEARCH_STATUS_LABELS[s.status]}
                </Badge>
                {s.issue_flag ? (
                  <Badge variant="outline" className="gap-1 border-destructive/40 bg-destructive/10 text-xs text-destructive">
                    <AlertTriangle className="h-3 w-3" /> Issue
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {SEARCH_TYPE_LABELS[s.search_type]}
                {s.provider ? ` · ${s.provider}` : ''}
                {s.reference ? ` · ref ${s.reference}` : ''}
                {s.ordered_at ? ` · ordered ${formatMatterDate(s.ordered_at)}` : ''}
                {s.received_at ? ` · received ${formatMatterDate(s.received_at)}` : ''}
                {s.cost_amount != null ? ` · ${formatCurrency(s.cost_amount)}` : ''}
              </p>
              {s.result_summary ? (
                <p className="text-xs text-muted-foreground">{s.result_summary}</p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canEdit ? (
                <Select
                  value={s.status}
                  onValueChange={(v) => void onSetStatus(s.id, v as LegalSearchStatus)}
                >
                  <SelectTrigger className="h-9 w-[150px]" aria-label={`Status for ${s.label}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEARCH_STATUS_OPTIONS.map((v) => (
                      <SelectItem key={v} value={v}>{SEARCH_STATUS_LABELS[v]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {canEdit ? (
                <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => openEdit(s)}>
                  <Pencil className="h-4 w-4" aria-label={`Edit ${s.label}`} />
                </Button>
              ) : null}
              {canDelete ? (
                <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => void onDelete(s.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" aria-label={`Remove ${s.label}`} />
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit search' : 'Add search'}</DialogTitle>
            <DialogDescription>Track what was ordered, when it landed and what it revealed.</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Search type</Label>
                  <Select
                    value={draft.search_type}
                    onValueChange={(v) => setDraft({
                      ...draft,
                      search_type: v as LegalSearchType,
                      label: draft.label && draft.label !== SEARCH_TYPE_LABELS[draft.search_type]
                        ? draft.label
                        : SEARCH_TYPE_LABELS[v as LegalSearchType],
                    })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SEARCH_TYPE_OPTIONS.map((t) => (
                        <SelectItem key={t} value={t}>{SEARCH_TYPE_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Status</Label>
                  <Select
                    value={draft.status}
                    onValueChange={(v) => setDraft({ ...draft, status: v as LegalSearchStatus })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SEARCH_STATUS_OPTIONS.map((v) => (
                        <SelectItem key={v} value={v}>{SEARCH_STATUS_LABELS[v]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="search-label">Label</Label>
                <Input
                  id="search-label" value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="search-provider">Provider</Label>
                  <Input
                    id="search-provider" value={draft.provider}
                    onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="search-ref">Reference</Label>
                  <Input
                    id="search-ref" value={draft.reference}
                    onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="search-ordered">Ordered</Label>
                  <Input
                    id="search-ordered" type="date" value={draft.ordered_at}
                    onChange={(e) => setDraft({ ...draft, ordered_at: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="search-received">Received</Label>
                  <Input
                    id="search-received" type="date" value={draft.received_at}
                    onChange={(e) => setDraft({ ...draft, received_at: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="search-due">Due</Label>
                  <Input
                    id="search-due" type="date" value={draft.due_date}
                    onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="search-cost">Cost (AUD)</Label>
                  <Input
                    id="search-cost" inputMode="decimal" value={draft.cost_amount}
                    onChange={(e) => setDraft({ ...draft, cost_amount: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="search-result">Result summary</Label>
                <Textarea
                  id="search-result" rows={3} value={draft.result_summary}
                  onChange={(e) => setDraft({ ...draft, result_summary: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Label htmlFor="search-issue">Flag an issue</Label>
                  <p className="text-xs text-muted-foreground">Surfaces this search as a risk on the matter.</p>
                </div>
                <Switch
                  id="search-issue" checked={draft.issue_flag}
                  onCheckedChange={(v) => setDraft({ ...draft, issue_flag: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Label htmlFor="search-client">Share with client</Label>
                  <p className="text-xs text-muted-foreground">Visible in the Client Portal.</p>
                </div>
                <Switch
                  id="search-client" checked={draft.visible_to_client}
                  onCheckedChange={(v) => setDraft({ ...draft, visible_to_client: v })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              disabled={saving || !draft?.label.trim()}
              onClick={async () => {
                if (!draft) return;
                await onSave(draft);
                setDraft(null);
              }}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default MatterSearchesPanel;
