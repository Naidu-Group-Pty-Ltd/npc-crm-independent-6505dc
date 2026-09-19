import { useEffect, useMemo, useState } from "react";
import { Landmark, PlusCircle, Trash2, Link2, ClipboardCheck, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";
import {
  amlFinanceApi,
  type AmlFinanceComparison,
  type AmlFinanceDiscrepancy,
  type AmlEvidenceReference,
  type AmlDiscrepancyStatus,
  type AmlFinanceRequest,
  type AmlFinanceRequestKind,
} from "@/lib/aml/amlFinanceApi";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { LegacyAliasBanner } from "@/components/aml/LegacyAliasBanner";
import {
  AmlMetricCard,
  AmlPageHeader,
  AmlRefreshButton,
  AmlTableEmptyRow,
} from "@/components/aml/primitives";
import { normalizeExternalUrl } from "@/lib/security/externalUrl";


const SEVERITY_TONE: Record<string, string> = {
  info: "bg-muted text-muted-foreground",
  low: "bg-primary/15 text-primary",
  medium: "bg-warning/15 text-warning",
  high: "bg-destructive/15 text-destructive",
  critical: "bg-destructive text-destructive-foreground",
};
const STATUS_TONE: Record<string, string> = {
  open: "bg-warning/15 text-warning",
  under_review: "bg-primary/15 text-primary",
  resolved: "bg-success/15 text-success",
  waived: "bg-muted text-muted-foreground",
  escalated: "bg-destructive/15 text-destructive",
};

function money(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function AmlFinance() {
  const { canWrite } = useAmlAccess();
  const [cases, setCases] = useState<AmlCase[]>([]);
  const [caseId, setCaseId] = useState<string>("");
  const [tab, setTab] = useState("comparisons");
  const [comparisons, setComparisons] = useState<AmlFinanceComparison[]>([]);
  const [discrepancies, setDiscrepancies] = useState<AmlFinanceDiscrepancy[]>([]);
  const [evidence, setEvidence] = useState<AmlEvidenceReference[]>([]);
  const [requests, setRequests] = useState<AmlFinanceRequest[]>([]);
  const [reqOpen, setReqOpen] = useState(false);
  const [reqForm, setReqForm] = useState<{ kind: AmlFinanceRequestKind; subject: string; message: string }>({
    kind: "funding_information", subject: "", message: "",
  });
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<Partial<AmlFinanceComparison>>({});
  const [evOpen, setEvOpen] = useState(false);
  const [evForm, setEvForm] = useState<Partial<AmlEvidenceReference>>({ reference_type: "finance_document" });
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const currentCase = useMemo(() => cases.find((c) => c.id === caseId) ?? null, [cases, caseId]);
  const latestComparison = comparisons[0] ?? null;

  useEffect(() => {
    (async () => {
      try {
        const { cases: list } = await amlCasesApi.list({ limit: 100 });
        setCases(list);
        if (list.length && !caseId) setCaseId(list[0].id);
      } catch (e: any) { toast.error(e?.message ?? "Failed to load cases"); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    if (!caseId) return;
    setBusy(true);
    try {
      const [c, d, e, r] = await Promise.all([
        amlFinanceApi.listComparisons(caseId),
        amlFinanceApi.listDiscrepancies({ case_id: caseId }),
        amlFinanceApi.listEvidence(caseId),
        amlFinanceApi.listFinanceRequests(caseId).catch(() => ({ requests: [] })),
      ]);
      setComparisons(c.comparisons);
      setDiscrepancies(d.discrepancies);
      setEvidence(e.evidence);
      setRequests(r.requests ?? []);
    } catch (err: any) { toast.error(err?.message ?? "Failed to load"); }
    finally { setBusy(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [caseId]);

  const filteredDiscrepancies = useMemo(() => {
    if (statusFilter === "all") return discrepancies;
    return discrepancies.filter((d) => d.status === statusFilter);
  }, [discrepancies, statusFilter]);

  const openDiscrepancyCount = discrepancies.filter((d) => ["open", "under_review", "escalated"].includes(d.status)).length;

  const handleCreateComparison = async () => {
    if (!caseId) return;
    setBusy(true);
    try {
      const res = await amlFinanceApi.upsertComparison({
        case_id: caseId,
        source: (form.source as any) ?? "manual_entry",
        purchase_price: form.purchase_price != null ? Number(form.purchase_price) : null,
        loan_amount: form.loan_amount != null ? Number(form.loan_amount) : null,
        lender: form.lender ?? null,
        lvr: form.lvr != null ? Number(form.lvr) : null,
        borrower_contribution: form.borrower_contribution != null ? Number(form.borrower_contribution) : null,
        refi_equity: form.refi_equity != null ? Number(form.refi_equity) : null,
        gift_amount: form.gift_amount != null ? Number(form.gift_amount) : null,
        gift_source: form.gift_source ?? null,
        smsf_lrba: Boolean(form.smsf_lrba),
        loan_purpose: form.loan_purpose ?? null,
        funding_notes: form.funding_notes ?? null,
      });
      toast.success(`Snapshot saved · ${res.discrepancies_created} discrepancies detected`);
      setAddOpen(false); setForm({});
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Failed to save"); }
    finally { setBusy(false); }
  };

  const handleImport = async () => {
    if (!caseId || !currentCase?.purchase_file_id) return;
    setBusy(true);
    try {
      const res = await amlFinanceApi.importFromPurchaseFile(caseId, currentCase.purchase_file_id);
      toast.success(`Imported · ${res.discrepancies_created} discrepancies detected`);
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Import failed"); }
    finally { setBusy(false); }
  };

  const handleResolve = async (id: string, status: AmlDiscrepancyStatus) => {
    setBusy(true);
    try {
      await amlFinanceApi.resolveDiscrepancy(id, status);
      toast.success(`Discrepancy ${status}`);
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  const handleAddEvidence = async () => {
    if (!caseId || !evForm.label) return;
    const externalUrl = evForm.external_url?.trim()
      ? normalizeExternalUrl(evForm.external_url)
      : null;
    if (evForm.external_url?.trim() && !externalUrl) {
      toast.error("External URL must be an absolute http:// or https:// URL");
      return;
    }
    setBusy(true);
    try {
      await amlFinanceApi.addEvidence({
        case_id: caseId,
        reference_type: evForm.reference_type ?? "finance_document",
        label: evForm.label,
        detail: evForm.detail ?? null,
        external_url: externalUrl,
        comparison_id: latestComparison?.id ?? null,
      } as any);
      toast.success("Evidence attached");
      setEvOpen(false); setEvForm({ reference_type: "finance_document" });
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  const [reqDiscrepancyId, setReqDiscrepancyId] = useState<string | null>(null);
  const openRequestCount = requests.filter((r) => ["open", "submitted", "clarification_required"].includes(r.status)).length;

  const handleCreateRequest = async () => {
    if (!caseId || !reqForm.subject.trim() || !reqForm.message.trim()) return;
    setBusy(true);
    try {
      await amlFinanceApi.createFinanceRequest({
        case_id: caseId,
        kind: reqForm.kind,
        subject: reqForm.subject.trim(),
        message: reqForm.message.trim(),
        purchase_file_id: currentCase?.purchase_file_id ?? undefined,
        discrepancy_id: reqDiscrepancyId ?? undefined,
      });
      toast.success("Request sent to the finance partner");
      setReqOpen(false);
      setReqForm({ kind: "funding_information", subject: "", message: "" });
      setReqDiscrepancyId(null);
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Failed to send request"); }
    finally { setBusy(false); }
  };

  const handleReviewRequest = async (id: string) => {
    setBusy(true);
    try {
      await amlFinanceApi.reviewFinanceRequest(id);
      toast.success("Marked under review");
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  const handleResolveRequest = async (
    id: string,
    financeStatusAfter?: "accepted" | "no_further_action",
  ) => {
    setBusy(true);
    try {
      await amlFinanceApi.resolveFinanceRequest({
        request_id: id, outcome: "resolved", finance_status_after: financeStatusAfter,
      });
      toast.success("Request resolved");
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  const askClarification = (discrepancy: AmlFinanceDiscrepancy) => {
    setReqDiscrepancyId(discrepancy.id);
    setReqForm({
      kind: "clarification",
      subject: "Clarification needed on funding details",
      message: "",
    });
    setReqOpen(true);
  };

  return (
    <div className="space-y-4">
      <LegacyAliasBanner label="Funding & Finance" tabHint="finance" routePath="/admin/aml/finance" />
      <AmlPageHeader
        title="Finance Comparison"
        description="Cross-check loan, lender, LVR, contributions and gifts declared by Finance vs the AML case."
        icon={Landmark}
        actions={
          <>
            <Select value={caseId} onValueChange={setCaseId}>
              <SelectTrigger aria-label="Select case" className="w-full sm:w-[320px]"><SelectValue placeholder="Select case" /></SelectTrigger>
              <SelectContent>
                {cases.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.case_reference} — {c.subject_display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AmlRefreshButton onClick={load} loading={busy} />
          </>
        }
      />

      {/* Summary tiles */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <AmlMetricCard
          title="Latest loan amount"
          state={busy ? "loading" : "ready"}
          value={money(latestComparison?.loan_amount)}
          hint={latestComparison?.lender ?? "No lender"}
        />
        <AmlMetricCard
          title="Purchase price"
          state={busy ? "loading" : "ready"}
          value={money(latestComparison?.purchase_price)}
          hint={`LVR ${latestComparison?.lvr ?? "—"}%`}
        />
        <AmlMetricCard
          title="Borrower contribution"
          state={busy ? "loading" : "ready"}
          value={money(latestComparison?.borrower_contribution)}
          hint={`Gift ${money(latestComparison?.gift_amount)} · Refi ${money(latestComparison?.refi_equity)}`}
        />
        <AmlMetricCard
          title="Open discrepancies"
          state={busy ? "loading" : "ready"}
          value={openDiscrepancyCount}
          hint={`${discrepancies.length} total`}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="comparisons">Snapshots</TabsTrigger>
          <TabsTrigger value="discrepancies">Discrepancies {openDiscrepancyCount > 0 && (
            <Badge variant="secondary" className="ml-2">{openDiscrepancyCount}</Badge>
          )}</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="requests">Requests {openRequestCount > 0 && (
            <Badge variant="secondary" className="ml-2">{openRequestCount}</Badge>
          )}</TabsTrigger>
        </TabsList>

        <TabsContent value="comparisons" className="space-y-3">
          <div className="flex items-center justify-end gap-2">
            {currentCase?.purchase_file_id && (
              <Button variant="outline" size="sm" onClick={handleImport} disabled={!canWrite || busy}>
                <Link2 className="mr-2 h-4 w-4" /> Import from purchase file
              </Button>
            )}
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={!canWrite || !caseId}>
                  <PlusCircle className="mr-2 h-4 w-4" /> New snapshot
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                <DialogHeader><DialogTitle>Finance snapshot</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label>Source</Label>
                    <Select value={(form.source as string) ?? "manual_entry"} onValueChange={(v) => setForm({ ...form, source: v as any })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="finance_portal">Finance portal</SelectItem>
                        <SelectItem value="client_portal">Client portal</SelectItem>
                        <SelectItem value="manual_entry">Manual entry</SelectItem>
                        <SelectItem value="ingested_doc">Ingested doc</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Purchase price</Label>
                    <Input type="number" value={(form.purchase_price as any) ?? ""} onChange={(e) => setForm({ ...form, purchase_price: Number(e.target.value) })} /></div>
                  <div><Label>Loan amount</Label>
                    <Input type="number" value={(form.loan_amount as any) ?? ""} onChange={(e) => setForm({ ...form, loan_amount: Number(e.target.value) })} /></div>
                  <div><Label>Lender</Label>
                    <Input value={form.lender ?? ""} onChange={(e) => setForm({ ...form, lender: e.target.value })} /></div>
                  <div><Label>LVR (%)</Label>
                    <Input type="number" step="0.1" value={(form.lvr as any) ?? ""} onChange={(e) => setForm({ ...form, lvr: Number(e.target.value) })} /></div>
                  <div><Label>Borrower contribution</Label>
                    <Input type="number" value={(form.borrower_contribution as any) ?? ""} onChange={(e) => setForm({ ...form, borrower_contribution: Number(e.target.value) })} /></div>
                  <div><Label>Refi equity</Label>
                    <Input type="number" value={(form.refi_equity as any) ?? ""} onChange={(e) => setForm({ ...form, refi_equity: Number(e.target.value) })} /></div>
                  <div><Label>Gift amount</Label>
                    <Input type="number" value={(form.gift_amount as any) ?? ""} onChange={(e) => setForm({ ...form, gift_amount: Number(e.target.value) })} /></div>
                  <div><Label>Gift source</Label>
                    <Input value={form.gift_source ?? ""} onChange={(e) => setForm({ ...form, gift_source: e.target.value })} /></div>
                  <div className="col-span-2 flex items-center gap-3">
                    <Switch checked={Boolean(form.smsf_lrba)} onCheckedChange={(v) => setForm({ ...form, smsf_lrba: v })} />
                    <Label>SMSF LRBA</Label>
                  </div>
                  <div className="col-span-2"><Label>Loan purpose</Label>
                    <Input value={form.loan_purpose ?? ""} onChange={(e) => setForm({ ...form, loan_purpose: e.target.value })} /></div>
                  <div className="col-span-2"><Label>Notes</Label>
                    <Textarea rows={3} value={form.funding_notes ?? ""} onChange={(e) => setForm({ ...form, funding_notes: e.target.value })} /></div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
                  <Button onClick={handleCreateComparison} disabled={busy}>Save snapshot</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table aria-label="Finance snapshots">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Captured</TableHead>
                    <TableHead scope="col">Source</TableHead>
                    <TableHead scope="col">Lender</TableHead>
                    <TableHead scope="col" className="text-right">Price</TableHead>
                    <TableHead scope="col" className="text-right">Loan</TableHead>
                    <TableHead scope="col" className="text-right">LVR</TableHead>
                    <TableHead scope="col" className="text-right">Contribution</TableHead>
                    <TableHead scope="col" className="text-right">Gift</TableHead>
                    <TableHead scope="col">SMSF</TableHead>
                    <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparisons.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-xs">{new Date(c.captured_at).toLocaleString('en-AU')}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{c.source.replace("_", " ")}</Badge></TableCell>
                      <TableCell>{c.lender ?? "—"}</TableCell>
                      <TableCell className="text-right">{money(c.purchase_price)}</TableCell>
                      <TableCell className="text-right">{money(c.loan_amount)}</TableCell>
                      <TableCell className="text-right">{c.lvr ?? "—"}</TableCell>
                      <TableCell className="text-right">{money(c.borrower_contribution)}</TableCell>
                      <TableCell className="text-right">{money(c.gift_amount)}</TableCell>
                      <TableCell>{c.smsf_lrba ? "Yes" : "—"}</TableCell>
                      <TableCell className="text-right">
                        {canWrite && (
                          <Button variant="ghost" size="icon" onClick={async () => {
                            if (!confirm("Delete this snapshot?")) return;
                            await amlFinanceApi.deleteComparison(c.id); await load();
                          }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {comparisons.length === 0 && (
                    <AmlTableEmptyRow colSpan={10}>
                      No snapshots yet. Import from the purchase file or add manually.
                    </AmlTableEmptyRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="discrepancies" className="space-y-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Filter status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="under_review">Under review</SelectItem>
                <SelectItem value="escalated">Escalated</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="waived">Waived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table aria-label="Finance discrepancies">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Detected</TableHead>
                    <TableHead scope="col">Kind</TableHead>
                    <TableHead scope="col">Severity</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col">Summary</TableHead>
                    <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDiscrepancies.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-xs">{new Date(d.created_at).toLocaleString('en-AU')}</TableCell>
                      <TableCell><code className="text-xs">{d.kind}</code></TableCell>
                      <TableCell><Badge className={SEVERITY_TONE[d.severity]}>{d.severity}</Badge></TableCell>
                      <TableCell><Badge className={STATUS_TONE[d.status]}>{d.status.replace("_", " ")}</Badge></TableCell>
                      <TableCell className="max-w-[420px]">
                        <div className="text-sm">{d.summary}</div>
                        {d.detail && <div className="text-xs text-muted-foreground">{d.detail}</div>}
                        {d.resolution_note && <div className="text-xs text-success mt-1">✓ {d.resolution_note}</div>}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {canWrite && ["open", "under_review"].includes(d.status) && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => askClarification(d)}>Ask finance</Button>
                            <Button size="sm" variant="outline" onClick={() => handleResolve(d.id, "resolved")}>Resolve</Button>
                            <Button size="sm" variant="outline" onClick={() => handleResolve(d.id, "escalated")}>Escalate</Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredDiscrepancies.length === 0 && (
                    <AmlTableEmptyRow colSpan={6}>
                      No discrepancies. New ones appear automatically when snapshots are saved.
                    </AmlTableEmptyRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="evidence" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={evOpen} onOpenChange={setEvOpen}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={!canWrite || !caseId}><PlusCircle className="mr-2 h-4 w-4" /> Add evidence reference</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Attach evidence</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Type</Label>
                    <Select value={evForm.reference_type} onValueChange={(v) => setEvForm({ ...evForm, reference_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="finance_document">Finance document</SelectItem>
                        <SelectItem value="finance_decision">Finance decision</SelectItem>
                        <SelectItem value="valuation">Valuation</SelectItem>
                        <SelectItem value="manual_note">Manual note</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Label</Label><Input value={evForm.label ?? ""} onChange={(e) => setEvForm({ ...evForm, label: e.target.value })} /></div>
                  <div><Label>External URL (optional)</Label><Input value={evForm.external_url ?? ""} onChange={(e) => setEvForm({ ...evForm, external_url: e.target.value })} /></div>
                  <div><Label>Detail</Label><Textarea rows={3} value={evForm.detail ?? ""} onChange={(e) => setEvForm({ ...evForm, detail: e.target.value })} /></div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setEvOpen(false)}>Cancel</Button>
                  <Button onClick={handleAddEvidence} disabled={busy || !evForm.label}>Attach</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table aria-label="Evidence references">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Added</TableHead>
                    <TableHead scope="col">Type</TableHead>
                    <TableHead scope="col">Label</TableHead>
                    <TableHead scope="col">Detail</TableHead>
                    <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evidence.map((e) => {
                    const externalUrl = normalizeExternalUrl(e.external_url);
                    return <TableRow key={e.id}>
                      <TableCell className="text-xs">{new Date(e.created_at).toLocaleString('en-AU')}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{e.reference_type.replace("_", " ")}</Badge></TableCell>
                      <TableCell>
                        {externalUrl
                          ? <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">{e.label}</a>
                          : e.label}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[420px]">{e.detail}</TableCell>
                      <TableCell className="text-right">
                        {canWrite && (
                          <Button variant="ghost" size="icon" onClick={async () => {
                            if (!confirm("Remove evidence?")) return;
                            await amlFinanceApi.deleteEvidence(e.id); await load();
                          }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>;
                  })}
                  {evidence.length === 0 && (
                    <AmlTableEmptyRow colSpan={5}>
                      No evidence attached yet. Add a reference to link finance documents to this case.
                    </AmlTableEmptyRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="requests" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground max-w-xl">
              Requests go to the finance partner assigned to this client. Write the message in
              plain, finance-safe language — never include internal reasoning, risk or screening detail.
            </p>
            <Dialog open={reqOpen} onOpenChange={(v) => { setReqOpen(v); if (!v) setReqDiscrepancyId(null); }}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={!canWrite || !caseId}>
                  <PlusCircle className="mr-2 h-4 w-4" /> New request
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Ask the finance partner</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Type</Label>
                    <Select value={reqForm.kind} onValueChange={(v) => setReqForm({ ...reqForm, kind: v as AmlFinanceRequestKind })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="funding_information">Funding information</SelectItem>
                        <SelectItem value="financial_evidence">Financial evidence</SelectItem>
                        <SelectItem value="clarification">Clarification</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {reqDiscrepancyId && (
                    <p className="text-xs text-muted-foreground">
                      Linked to a detected discrepancy. Only the wording below reaches the finance
                      partner — the discrepancy detail stays internal.
                    </p>
                  )}
                  <div><Label>Subject</Label>
                    <Input value={reqForm.subject} onChange={(e) => setReqForm({ ...reqForm, subject: e.target.value })} /></div>
                  <div><Label>Message (shown to the finance partner)</Label>
                    <Textarea rows={4} value={reqForm.message} onChange={(e) => setReqForm({ ...reqForm, message: e.target.value })}
                      placeholder="e.g. Please confirm the loan amount and lender for this purchase, and how the balance of funds will be sourced." /></div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setReqOpen(false)}>Cancel</Button>
                  <Button onClick={handleCreateRequest} disabled={busy || !reqForm.subject.trim() || !reqForm.message.trim()}>
                    Send request
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table aria-label="Finance information requests">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Sent</TableHead>
                    <TableHead scope="col">Type</TableHead>
                    <TableHead scope="col">Subject</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col">Response</TableHead>
                    <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{new Date(r.created_at).toLocaleDateString('en-AU')}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{r.kind.replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="max-w-[280px]">
                        <div className="truncate text-sm">{r.subject}</div>
                        <div className="truncate text-xs text-muted-foreground">{r.message}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">{r.status.replace(/_/g, " ")}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[260px] text-xs text-muted-foreground">
                        {r.responded_at ? (
                          <>
                            <div>{r.responded_by_label ?? "Finance partner"} · {new Date(r.responded_at).toLocaleDateString('en-AU')}</div>
                            {r.response_payload?.text && <div className="truncate">{r.response_payload.text}</div>}
                            {r.comparison_id && <div>Funding snapshot recorded</div>}
                          </>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {canWrite && r.status === "submitted" && (
                          <>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => handleReviewRequest(r.id)}>Review</Button>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => handleResolveRequest(r.id, "accepted")}>Accept</Button>
                          </>
                        )}
                        {canWrite && ["open", "clarification_required", "submitted"].includes(r.status) && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => handleResolveRequest(r.id)}>Close</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {requests.length === 0 && (
                    <AmlTableEmptyRow colSpan={6}>
                      No requests yet. Send one to start the finance information loop.
                    </AmlTableEmptyRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {latestComparison?.smsf_lrba && (
        <Card className="border-warning/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-warning text-base">
              <AlertTriangle className="h-4 w-4" /> SMSF LRBA declared
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Confirm trustee structure, custodian bare trust, single-acquirable-asset rule and lender consent.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
