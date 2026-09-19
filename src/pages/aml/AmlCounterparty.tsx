import { useEffect, useMemo, useState } from "react";
import { Users, Building2, Search, Plus, Trash2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchInput } from '@/components/ui/search-input';
import {
  AmlEmptyState,
  AmlLoadingState,
  AmlPageHeader,
  AmlRefreshButton,
} from "@/components/aml/primitives";
import { toast } from "sonner";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import {
  amlEntitiesApi, type AmlEntity, type AmlEntityType, type AmlBeneficialOwner,
  type AmlAuthorisedRep, type AmlOwnershipSummary, type AmlControlType, type AmlVerificationState,
} from "@/lib/aml/amlEntitiesApi";

const ENTITY_TYPES: AmlEntityType[] = ["company", "trust", "smsf", "partnership", "sole_trader", "other"];
const CONTROL_TYPES: AmlControlType[] = ["shareholding", "trustee", "beneficiary", "appointor", "director", "partner", "settlor", "other"];
const VERIF_STATES: AmlVerificationState[] = ["unverified", "pending", "verified", "failed", "waived"];

function verifBadge(v: AmlVerificationState) {
  const map: Record<AmlVerificationState, string> = {
    verified: "border-success/40 text-success",
    pending: "border-warning/40 text-warning",
    unverified: "border-muted-foreground/40 text-muted-foreground",
    failed: "border-destructive/40 text-destructive",
    waived: "border-info/40 text-info",
  };
  return <Badge variant="outline" className={`capitalize ${map[v]}`}>{v}</Badge>;
}

export default function AmlCounterparty() {
  const { canWrite } = useAmlAccess();
  const [loading, setLoading] = useState(true);
  const [entities, setEntities] = useState<AmlEntity[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AmlEntityType | "all">("all");
  const [selected, setSelected] = useState<AmlEntity | null>(null);
  const [detail, setDetail] = useState<{
    owners: AmlBeneficialOwner[]; reps: AmlAuthorisedRep[]; summary: AmlOwnershipSummary | null;
  }>({ owners: [], reps: [], summary: null });
  const [createOpen, setCreateOpen] = useState(false);

  const loadEntities = async () => {
    setLoading(true);
    try {
      const { entities } = await amlEntitiesApi.listEntities({
        search: search || undefined,
        entity_type: typeFilter === "all" ? undefined : typeFilter,
        limit: 200,
      });
      setEntities(entities);
      if (selected && !entities.find((e) => e.id === selected.id)) setSelected(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load entities");
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: string) => {
    try {
      const [{ owners, reps }, { summary }] = await Promise.all([
        amlEntitiesApi.getEntity(id),
        amlEntitiesApi.ownershipSummary(id),
      ]);
      setDetail({ owners, reps, summary });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load entity detail");
    }
  };

  useEffect(() => { loadEntities(); }, []);
  useEffect(() => { if (selected) loadDetail(selected.id); else setDetail({ owners: [], reps: [], summary: null }); }, [selected?.id]);

  const filteredCounts = useMemo(() => {
    const c: Record<string, number> = { all: entities.length };
    for (const t of ENTITY_TYPES) c[t] = entities.filter((e) => e.entity_type === t).length;
    return c;
  }, [entities]);

  return (
    <div className="space-y-6">
      <AmlPageHeader
        title="Counterparty & Structures"
        description={'Companies, trusts, SMSFs, beneficial owners and authorised representatives — the AUSTRAC "Know Your Customer" structural spine.'}
        icon={Users}
        actions={
          <>
            <AmlRefreshButton onClick={loadEntities} loading={loading} />
            {canWrite && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> New entity
              </Button>
            )}
          </>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search legal name, trading name, ABN or ACN…"
              onKeyDown={(e) => e.key === "Enter" && loadEntities()}
              containerClassName="min-w-[240px] flex-1"
              iconClassName="left-2.5"
            />
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types ({filteredCounts.all ?? 0})</SelectItem>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">
                    {t.replace("_", " ")} ({filteredCounts[t] ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="secondary" size="sm" onClick={loadEntities}>Apply</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid gap-0 md:grid-cols-[minmax(320px,420px)_1fr]">
            <ScrollArea className="h-[60vh] min-h-[320px] border-r border-border/60">
              <div className="divide-y divide-border/60">
                {loading ? (
                  <AmlLoadingState variant="list" lines={6} label="Loading entities…" className="p-3" />
                ) : entities.length === 0 ? (
                  <AmlEmptyState
                    className="m-3"
                    icon={Building2}
                    body="No entities yet. Create one to start populating beneficial owners."
                    action={canWrite ? (
                      <Button size="sm" onClick={() => setCreateOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" /> New entity
                      </Button>
                    ) : undefined}
                  />
                ) : entities.map((e) => (
                  <button key={e.id} onClick={() => setSelected(e)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 ${
                      selected?.id === e.id ? "bg-primary/5" : ""
                    }`}>
                    <Building2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{e.legal_name}</span>
                        {e.is_sanctioned && <Badge variant="destructive" className="h-5">Sanctioned</Badge>}
                        {e.is_pep_linked && <Badge variant="outline" className="h-5 border-warning/40 text-warning">PEP</Badge>}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground truncate">
                        <span className="capitalize">{e.entity_type.replace("_", " ")}</span>
                        {e.abn && <> · ABN {e.abn}</>}
                        {e.acn && <> · ACN {e.acn}</>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>

            <div className="p-4">
              {!selected ? (
                <AmlEmptyState
                  className="flex min-h-[320px] flex-col items-center justify-center"
                  icon={Users}
                  title="No entity selected"
                  body="Select an entity to inspect beneficial owners, authorised representatives and case links."
                />
              ) : (
                <EntityDetail
                  entity={selected}
                  owners={detail.owners}
                  reps={detail.reps}
                  summary={detail.summary}
                  canWrite={canWrite}
                  onChanged={() => { loadDetail(selected.id); loadEntities(); }}
                  onDeleted={() => { setSelected(null); loadEntities(); }}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <CreateEntityDialog open={createOpen} onOpenChange={setCreateOpen}
        onCreated={(e) => { setCreateOpen(false); loadEntities(); setSelected(e); }} />
    </div>
  );
}

// ─── Detail panel ───────────────────────────────────────────────────
function EntityDetail({
  entity, owners, reps, summary, canWrite, onChanged, onDeleted,
}: {
  entity: AmlEntity; owners: AmlBeneficialOwner[]; reps: AmlAuthorisedRep[];
  summary: AmlOwnershipSummary | null; canWrite: boolean; onChanged: () => void; onDeleted: () => void;
}) {
  const [ownerOpen, setOwnerOpen] = useState<AmlBeneficialOwner | null>(null);
  const [repOpen, setRepOpen] = useState<AmlAuthorisedRep | null>(null);
  const [newOwner, setNewOwner] = useState(false);
  const [newRep, setNewRep] = useState(false);
  const [editEntity, setEditEntity] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete "${entity.legal_name}" and all of its owners/reps? This cannot be undone.`)) return;
    try { await amlEntitiesApi.deleteEntity(entity.id); toast.success("Entity deleted"); onDeleted(); }
    catch (e: any) { toast.error(e?.message ?? "Delete failed"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold">{entity.legal_name}</h3>
            <Badge variant="outline" className="capitalize">{entity.entity_type.replace("_", " ")}</Badge>
          </div>
          {entity.trading_name && <p className="text-xs text-muted-foreground">Trading as {entity.trading_name}</p>}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {entity.jurisdiction}
            {entity.abn && <> · ABN {entity.abn}</>}
            {entity.acn && <> · ACN {entity.acn}</>}
            {entity.incorporation_date && <> · Incorporated {entity.incorporation_date}</>}
          </p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditEntity(true)}>Edit</Button>
            <Button variant="ghost" size="sm" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        )}
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <SummaryTile label="Owners" value={summary.total_owners} />
          <SummaryTile label="Ownership %" value={`${summary.total_ownership_percent}%`}
            warn={summary.total_ownership_percent < 100 || summary.total_ownership_percent > 100} />
          <SummaryTile label="UBOs (≥25%)" value={summary.ubo_count} />
          <SummaryTile label="PEP" value={summary.pep_count} warn={summary.pep_count > 0} />
          <SummaryTile label="Sanctioned" value={summary.sanctioned_count} warn={summary.sanctioned_count > 0} />
          <SummaryTile label="Unverified" value={summary.unverified_count} warn={summary.unverified_count > 0} />
        </div>
      )}

      <Tabs defaultValue="owners">
        <TabsList>
          <TabsTrigger value="owners">Beneficial owners ({owners.length})</TabsTrigger>
          <TabsTrigger value="reps">Authorised reps ({reps.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="owners" className="mt-3 space-y-2">
          {canWrite && owners.length > 0 && (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setNewOwner(true)}>
                <Plus className="mr-1 h-4 w-4" /> Add owner
              </Button>
            </div>
          )}
          {owners.length === 0 ? (
            <AmlEmptyState
              body="No beneficial owners captured. AUSTRAC requires all ≥25% owners and any person exercising control."
              action={canWrite ? (
                <Button size="sm" variant="outline" onClick={() => setNewOwner(true)}>
                  <Plus className="mr-1 h-4 w-4" /> Add owner
                </Button>
              ) : undefined}
            />
          ) : owners.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 p-3">
              <ShieldCheck className={`h-4 w-4 ${o.verification_state === "verified" ? "text-success" : "text-muted-foreground"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{o.full_name}</span>
                  {o.is_ubo && <Badge variant="secondary">UBO</Badge>}
                  {o.is_pep && <Badge variant="outline" className="border-warning/40 text-warning">PEP</Badge>}
                  {o.is_sanctioned && <Badge variant="destructive">Sanctioned</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {o.ownership_percent}% · <span className="capitalize">{o.control_type}</span> · {o.residential_country}
                </div>
              </div>
              {verifBadge(o.verification_state)}
              {canWrite && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setOwnerOpen(o)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (!confirm(`Remove ${o.full_name}?`)) return;
                    await amlEntitiesApi.deleteOwner(o.id); onChanged();
                  }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              )}
            </div>
          ))}
        </TabsContent>

        <TabsContent value="reps" className="mt-3 space-y-2">
          {canWrite && reps.length > 0 && (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setNewRep(true)}>
                <Plus className="mr-1 h-4 w-4" /> Add representative
              </Button>
            </div>
          )}
          {reps.length === 0 ? (
            <AmlEmptyState
              body="No authorised representatives yet. Directors, signatories and power-of-attorney holders should be recorded here."
              action={canWrite ? (
                <Button size="sm" variant="outline" onClick={() => setNewRep(true)}>
                  <Plus className="mr-1 h-4 w-4" /> Add representative
                </Button>
              ) : undefined}
            />
          ) : reps.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{r.full_name}</span>
                  {r.is_director && <Badge variant="secondary">Director</Badge>}
                  {r.is_signatory && <Badge variant="outline">Signatory</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.role_title}
                  {r.appointment_date && <> · appointed {r.appointment_date}</>}
                  {r.cessation_date && <> · ceased {r.cessation_date}</>}
                </div>
              </div>
              {verifBadge(r.verification_state)}
              {canWrite && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setRepOpen(r)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (!confirm(`Remove ${r.full_name}?`)) return;
                    await amlEntitiesApi.deleteRep(r.id); onChanged();
                  }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              )}
            </div>
          ))}
        </TabsContent>
      </Tabs>

      {editEntity && (
        <CreateEntityDialog open initial={entity} onOpenChange={() => setEditEntity(false)}
          onCreated={() => { setEditEntity(false); onChanged(); }} />
      )}

      {(newOwner || ownerOpen) && (
        <OwnerDialog open entity_id={entity.id} initial={ownerOpen}
          onOpenChange={() => { setNewOwner(false); setOwnerOpen(null); }}
          onSaved={() => { setNewOwner(false); setOwnerOpen(null); onChanged(); }} />
      )}
      {(newRep || repOpen) && (
        <RepDialog open entity_id={entity.id} initial={repOpen}
          onOpenChange={() => { setNewRep(false); setRepOpen(null); }}
          onSaved={() => { setNewRep(false); setRepOpen(null); onChanged(); }} />
      )}
    </div>
  );
}

/**
 * Compact inline counter for the detail pane. Deliberately not AmlMetricCard:
 * six of these sit in one row inside the pane, so they keep a tighter footprint
 * but follow the same shape — title above, tabular value below.
 */
function SummaryTile({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className={`rounded-md border p-2 text-center ${warn ? "border-warning/40 bg-warning/5" : "border-border/60"}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ─── Dialogs ────────────────────────────────────────────────────────
function CreateEntityDialog({
  open, initial, onOpenChange, onCreated,
}: { open: boolean; initial?: AmlEntity; onOpenChange: (v: boolean) => void; onCreated: (e: AmlEntity) => void }) {
  const [form, setForm] = useState<Partial<AmlEntity>>(() => initial ?? { entity_type: "company", jurisdiction: "AU", status: "active" });
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(initial?.id);

  const save = async () => {
    if (!form.legal_name || !form.entity_type) { toast.error("Legal name and type are required"); return; }
    setSaving(true);
    try {
      const { entity } = await amlEntitiesApi.upsertEntity({ ...initial, ...form });
      toast.success(isEdit ? "Entity updated" : "Entity created");
      onCreated(entity);
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "Edit entity" : "New entity"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label>Legal name *</Label>
            <Input value={form.legal_name ?? ""} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label>Type *</Label>
              <Select value={form.entity_type} onValueChange={(v) => setForm({ ...form, entity_type: v as AmlEntityType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ENTITY_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Jurisdiction</Label>
              <Input value={form.jurisdiction ?? ""} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Trading name</Label>
            <Input value={form.trading_name ?? ""} onChange={(e) => setForm({ ...form, trading_name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label>ABN</Label>
              <Input value={form.abn ?? ""} onChange={(e) => setForm({ ...form, abn: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>ACN</Label>
              <Input value={form.acn ?? ""} onChange={(e) => setForm({ ...form, acn: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Incorporation date</Label>
            <Input type="date" value={form.incorporation_date ?? ""}
              onChange={(e) => setForm({ ...form, incorporation_date: e.target.value || null })} />
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <Checkbox id="entity-pep-linked" checked={!!form.is_pep_linked}
                onCheckedChange={(v) => setForm({ ...form, is_pep_linked: v === true })} />
              <Label htmlFor="entity-pep-linked" className="font-normal">PEP-linked</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="entity-sanctioned" checked={!!form.is_sanctioned}
                onCheckedChange={(v) => setForm({ ...form, is_sanctioned: v === true })} />
              <Label htmlFor="entity-sanctioned" className="font-normal">Sanctioned</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : isEdit ? "Save" : "Create entity"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OwnerDialog({
  open, entity_id, initial, onOpenChange, onSaved,
}: { open: boolean; entity_id: string; initial?: AmlBeneficialOwner | null; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<AmlBeneficialOwner>>(() =>
    initial ?? { entity_id, control_type: "shareholding", verification_state: "unverified", residential_country: "AU", ownership_percent: 0 });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!form.full_name) { toast.error("Full name required"); return; }
    setSaving(true);
    try {
      await amlEntitiesApi.upsertOwner({ ...initial, ...form, entity_id });
      toast.success("Owner saved"); onSaved();
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{initial?.id ? "Edit owner" : "Add beneficial owner"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2"><Label>Full name *</Label>
            <Input value={form.full_name ?? ""} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2"><Label>Date of birth</Label>
              <Input type="date" value={form.date_of_birth ?? ""} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value || null })} /></div>
            <div className="grid gap-2"><Label>Residential country</Label>
              <Input value={form.residential_country ?? ""} onChange={(e) => setForm({ ...form, residential_country: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2"><Label>Ownership %</Label>
              <Input type="number" step="0.001" min={0} max={100} value={form.ownership_percent ?? 0}
                onChange={(e) => setForm({ ...form, ownership_percent: Number(e.target.value) })} /></div>
            <div className="grid gap-2"><Label>Control type</Label>
              <Select value={form.control_type} onValueChange={(v) => setForm({ ...form, control_type: v as AmlControlType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CONTROL_TYPES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
              </Select></div>
          </div>
          <div className="grid gap-2"><Label>Verification state</Label>
            <Select value={form.verification_state} onValueChange={(v) => setForm({ ...form, verification_state: v as AmlVerificationState })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{VERIF_STATES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <Checkbox id="owner-ubo" checked={!!form.is_ubo}
                onCheckedChange={(v) => setForm({ ...form, is_ubo: v === true })} />
              <Label htmlFor="owner-ubo" className="font-normal">Ultimate beneficial owner</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="owner-pep" checked={!!form.is_pep}
                onCheckedChange={(v) => setForm({ ...form, is_pep: v === true })} />
              <Label htmlFor="owner-pep" className="font-normal">PEP</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="owner-sanctioned" checked={!!form.is_sanctioned}
                onCheckedChange={(v) => setForm({ ...form, is_sanctioned: v === true })} />
              <Label htmlFor="owner-sanctioned" className="font-normal">Sanctioned</Label>
            </div>
          </div>
          <div className="grid gap-2"><Label>Notes</Label>
            <Textarea rows={3} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RepDialog({
  open, entity_id, initial, onOpenChange, onSaved,
}: { open: boolean; entity_id: string; initial?: AmlAuthorisedRep | null; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<AmlAuthorisedRep>>(() =>
    initial ?? { entity_id, role_title: "Director", verification_state: "unverified" });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!form.full_name || !form.role_title) { toast.error("Name and role required"); return; }
    setSaving(true);
    try {
      await amlEntitiesApi.upsertRep({ ...initial, ...form, entity_id });
      toast.success("Representative saved"); onSaved();
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{initial?.id ? "Edit representative" : "Add representative"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2"><Label>Full name *</Label>
            <Input value={form.full_name ?? ""} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div className="grid gap-2"><Label>Role title *</Label>
            <Input value={form.role_title ?? ""} onChange={(e) => setForm({ ...form, role_title: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2"><Label>Appointed</Label>
              <Input type="date" value={form.appointment_date ?? ""} onChange={(e) => setForm({ ...form, appointment_date: e.target.value || null })} /></div>
            <div className="grid gap-2"><Label>Ceased</Label>
              <Input type="date" value={form.cessation_date ?? ""} onChange={(e) => setForm({ ...form, cessation_date: e.target.value || null })} /></div>
          </div>
          <div className="grid gap-2"><Label>Verification state</Label>
            <Select value={form.verification_state} onValueChange={(v) => setForm({ ...form, verification_state: v as AmlVerificationState })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{VERIF_STATES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <Checkbox id="rep-director" checked={!!form.is_director}
                onCheckedChange={(v) => setForm({ ...form, is_director: v === true })} />
              <Label htmlFor="rep-director" className="font-normal">Director</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="rep-signatory" checked={!!form.is_signatory}
                onCheckedChange={(v) => setForm({ ...form, is_signatory: v === true })} />
              <Label htmlFor="rep-signatory" className="font-normal">Signatory</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
