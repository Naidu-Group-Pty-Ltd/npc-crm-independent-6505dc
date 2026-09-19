import { useEffect, useMemo, useState } from "react";
import { FileWarning, Plus, RefreshCw, Trash2, ShieldAlert, ShieldCheck, ScrollText, AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { AmlEmptyState, AmlPageHeader } from "@/components/aml/primitives";
import { toast } from "sonner";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { amlCasesApi } from "@/lib/aml/amlCasesApi";
import {
  amlTransactionsApi,
  type AmlTransaction, type AmlTransactionKind, type AmlTransactionStatus,
  type AmlTransactionParty, type AmlPartyType, type AmlTransactionEvent,
  type AmlCounterpartyCase, type AmlCounterpartyRequest, type AmlCpRequestStatus,
  type AmlTransactionObligation, type AmlObligationKind,
} from "@/lib/aml/amlTransactionsApi";

const TX_KINDS: AmlTransactionKind[] = ["purchase", "sale", "refinance", "off_the_plan", "auction", "private_treaty", "other"];
const TX_STATUSES: AmlTransactionStatus[] = ["draft", "under_contract", "unconditional", "settled", "terminated"];
const PARTY_TYPES: AmlPartyType[] = ["buyer", "seller", "guarantor", "agent", "solicitor", "mortgagee", "beneficiary", "other"];
const CP_REQUEST_TYPES = ["identity", "source_of_funds", "authority_docs", "trust_deed", "beneficial_ownership", "other"];
const CP_REQ_STATUSES: AmlCpRequestStatus[] = ["pending", "sent", "awaiting_response", "resolved", "waived", "escalated"];

const OBLIGATION_STATUS_TONE: Record<string, string> = {
  pending: "border-destructive/40 text-destructive",
  acknowledged: "border-warning/40 text-warning",
  report_created: "border-success/40 text-success",
  waived: "border-muted-foreground/40 text-muted-foreground",
};

function statusBadge(status: string) {
  const map: Record<string, string> = {
    draft: "border-muted-foreground/40 text-muted-foreground",
    under_contract: "border-info/40 text-info",
    unconditional: "border-warning/40 text-warning",
    settled: "border-success/40 text-success",
    terminated: "border-destructive/40 text-destructive",
  };
  return <Badge variant="outline" className={`capitalize ${map[status] ?? ""}`}>{status.replace(/_/g, " ")}</Badge>;
}

export default function AmlTransactions() {
  const { canWrite } = useAmlAccess();
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState<Array<{ id: string; case_reference: string; subject_display_name: string; purchase_file_id: string | null }>>([]);
  const [caseId, setCaseId] = useState<string>("");
  const [transactions, setTransactions] = useState<AmlTransaction[]>([]);
  const [selectedTx, setSelectedTx] = useState<AmlTransaction | null>(null);
  const [parties, setParties] = useState<AmlTransactionParty[]>([]);
  const [events, setEvents] = useState<AmlTransactionEvent[]>([]);
  const [cpCases, setCpCases] = useState<AmlCounterpartyCase[]>([]);
  const [cpRequests, setCpRequests] = useState<AmlCounterpartyRequest[]>([]);
  const [gate, setGate] = useState<Awaited<ReturnType<typeof amlTransactionsApi.settlementGateStatus>> | null>(null);
  const [obligations, setObligations] = useState<AmlTransactionObligation[]>([]);
  const [reevaluating, setReevaluating] = useState(false);
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [partyDialogOpen, setPartyDialogOpen] = useState(false);
  const [cpDialogOpen, setCpDialogOpen] = useState(false);
  const [reqDialogOpen, setReqDialogOpen] = useState(false);
  const [activeCpCase, setActiveCpCase] = useState<AmlCounterpartyCase | null>(null);

  // Load AML cases (via case_events schema — reuse aml.cases)
  useEffect(() => {
    (async () => {
      const { cases: data } = await amlCasesApi.list({ limit: 200 });
      setCases(data ?? []);
      if ((data ?? []).length && !caseId) setCaseId(data[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTransactions = async () => {
    if (!caseId) return;
    setLoading(true);
    try {
      const { transactions } = await amlTransactionsApi.listTransactions(caseId);
      setTransactions(transactions);
      if (transactions.length && !selectedTx) setSelectedTx(transactions[0]);
      else if (selectedTx && !transactions.find((t) => t.id === selectedTx.id)) setSelectedTx(transactions[0] ?? null);
      const { counterparty_cases } = await amlTransactionsApi.listCpCases(caseId);
      setCpCases(counterparty_cases);
      const { requests } = await amlTransactionsApi.listCpRequests({ case_id: caseId });
      setCpRequests(requests);
    } catch (e: any) { toast.error(e?.message ?? "Failed to load transactions"); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadTransactions(); /* eslint-disable-next-line */ }, [caseId]);

  useEffect(() => {
    if (!selectedTx) { setParties([]); setEvents([]); setGate(null); setObligations([]); return; }
    (async () => {
      const [{ parties: p }, { events: e }, obl] = await Promise.all([
        amlTransactionsApi.listParties(selectedTx.id),
        amlTransactionsApi.listEvents(selectedTx.id),
        amlTransactionsApi.listObligations({ transaction_id: selectedTx.id }).catch(() => ({ obligations: [] as AmlTransactionObligation[] })),
      ]);
      setParties(p); setEvents(e); setObligations(obl.obligations ?? []);
      if (selectedTx.purchase_file_id) {
        try { setGate(await amlTransactionsApi.settlementGateStatus(selectedTx.purchase_file_id)); }
        catch { setGate(null); }
      } else setGate(null);
    })();
  }, [selectedTx?.id]);

  const reloadObligations = async () => {
    if (!selectedTx) return;
    const { obligations: o } = await amlTransactionsApi.listObligations({ transaction_id: selectedTx.id });
    setObligations(o);
    if (selectedTx.purchase_file_id) {
      try { setGate(await amlTransactionsApi.settlementGateStatus(selectedTx.purchase_file_id)); } catch {}
    }
  };

  const runEvaluate = async () => {
    if (!selectedTx) return;
    setReevaluating(true);
    try {
      const r = await amlTransactionsApi.evaluateObligations(selectedTx.id);
      toast.success(r.created > 0 ? `${r.created} new obligation(s) detected` : "No new obligations detected");
      await reloadObligations();
    } catch (e: any) { toast.error(e?.message ?? "Evaluation failed"); }
    finally { setReevaluating(false); }
  };

  const currentCase = useMemo(() => cases.find((c) => c.id === caseId) ?? null, [cases, caseId]);

  return (
    <div className="space-y-6">
      <AmlPageHeader
        title="Transaction Compliance"
        description="Case-linked transactions, settlement gate and reportable-obligation checks."
        icon={FileWarning}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
      {/* LEFT: transactions list */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-2">
              <FileWarning className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Transactions</CardTitle>
              <Button size="icon" variant="ghost" className="ml-auto" aria-label="Refresh transactions" onClick={loadTransactions}>
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
            <Select value={caseId} onValueChange={setCaseId}>
              <SelectTrigger><SelectValue placeholder="Choose an AML case" /></SelectTrigger>
              <SelectContent>
                {cases.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.case_reference} — {c.subject_display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canWrite && caseId && (
              <Button size="sm" onClick={() => { setSelectedTx(null); setTxDialogOpen(true); }}>
                <Plus className="mr-1 h-4 w-4" /> New transaction
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[60vh] min-h-[320px]">
              {loading ? (
                <div className="space-y-2 p-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
              ) : transactions.length === 0 ? (
                <div className="p-4">
                  <AmlEmptyState body="No transactions captured yet for this case. Use “New transaction” to record the first one." />
                </div>
              ) : (
                <ul className="divide-y">
                  {transactions.map((t) => (
                    <li key={t.id}>
                      <button
                        onClick={() => setSelectedTx(t)}
                        className={`w-full px-4 py-3 text-left transition-colors hover:bg-muted/60 ${selectedTx?.id === t.id ? "bg-muted/70" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{t.reference || t.property_address || `${t.kind} transaction`}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {t.settlement_date ? `Settle ${t.settlement_date}` : "No settlement date"}
                              {t.purchase_price ? ` · $${Number(t.purchase_price).toLocaleString('en-AU')}` : ""}
                            </p>
                          </div>
                          {statusBadge(t.status)}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {selectedTx && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {gate?.blocked ? <ShieldAlert className="h-4 w-4 text-destructive" /> : <ShieldCheck className="h-4 w-4 text-success" />}
                Settlement gate
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!selectedTx.purchase_file_id ? (
                <p className="text-muted-foreground">Link a purchase file to evaluate the settlement gate.</p>
              ) : !gate ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={gate.gate_enabled ? "border-primary/40 text-primary" : "border-muted-foreground/40 text-muted-foreground"}>
                      {gate.gate_enabled ? "Gate ON" : "Gate OFF"}
                    </Badge>
                    <Badge variant="outline" className={gate.blocked ? "border-destructive/40 text-destructive" : "border-success/40 text-success"}>
                      {gate.blocked ? "Settlement blocked" : "Settlement clear"}
                    </Badge>
                  </div>
                  {gate.reasons.length > 0 && (
                    <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                      {gate.reasons.map((r) => <li key={r}>{r.replace(/_/g, " ")}</li>)}
                    </ul>
                  )}
                  {!gate.gate_enabled && (
                    <p className="text-xs text-muted-foreground">
                      Settlement gate enforcement is switched off — this check is advisory only.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* RIGHT: detail */}
      <div className="min-w-0">
        {!selectedTx ? (
          <AmlEmptyState
            title="No transaction selected"
            body="Select or create a transaction to manage counterparty CDD and settlement events."
          />
        ) : (
          <Tabs defaultValue="parties" className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold">{selectedTx.reference || selectedTx.property_address || "Transaction"}</h2>
                <p className="text-xs text-muted-foreground">
                  {selectedTx.kind.replace(/_/g, " ")} · {currentCase?.case_reference} · updated {new Date(selectedTx.updated_at).toLocaleString('en-AU')}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {canWrite && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setTxDialogOpen(true)}>Edit</Button>
                    <Button size="sm" variant="destructive" onClick={async () => {
                      if (!confirm("Delete this transaction?")) return;
                      await amlTransactionsApi.deleteTransaction(selectedTx.id);
                      setSelectedTx(null); loadTransactions();
                    }}>
                      <Trash2 className="mr-1 h-4 w-4" /> Delete
                    </Button>
                  </>
                )}
              </div>
              <TabsList>
                <TabsTrigger value="parties">Parties</TabsTrigger>
                <TabsTrigger value="counterparty">Counterparty CDD</TabsTrigger>
                <TabsTrigger value="obligations">
                  Obligations
                  {obligations.filter((o) => o.status === "pending").length > 0 && (
                    <Badge variant="outline" className="ml-2 border-destructive/40 text-destructive">
                      {obligations.filter((o) => o.status === "pending").length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="events">Timeline</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="parties" className="space-y-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Parties ({parties.length})</CardTitle>
                  {canWrite && (
                    <Button size="sm" onClick={() => setPartyDialogOpen(true)}>
                      <Plus className="mr-1 h-4 w-4" /> Add party
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-2">
                  {parties.length === 0 ? (
                    <AmlEmptyState body="No parties captured for this transaction yet. Record buyers, sellers and their representatives as they are identified." />
                  ) : parties.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <p className="text-sm font-medium">{p.display_name} <span className="ml-2 text-xs text-muted-foreground">({p.party_type})</span></p>
                        {p.capacity && <p className="text-xs text-muted-foreground">{p.capacity}</p>}
                      </div>
                      {canWrite && (
                        <Button size="icon" variant="ghost" onClick={async () => {
                          await amlTransactionsApi.deleteParty(p.id);
                          setParties((prev) => prev.filter((x) => x.id !== p.id));
                        }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="counterparty" className="space-y-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Counterparty cases ({cpCases.length})</CardTitle>
                  {canWrite && (
                    <Button size="sm" onClick={() => { setActiveCpCase(null); setCpDialogOpen(true); }}>
                      <Plus className="mr-1 h-4 w-4" /> New dossier
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {cpCases.length === 0 && (
                    <AmlEmptyState body="No counterparty dossiers open. Open one to run CDD on the other side of the transaction." />
                  )}
                  {cpCases.map((c) => {
                    const requests = cpRequests.filter((r) => r.counterparty_case_id === c.id);
                    return (
                      <div key={c.id} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{c.subject_display_name}</p>
                          <Badge variant="outline" className="capitalize">{c.subject_type}</Badge>
                          <Badge variant="outline" className="capitalize">{c.status.replace(/_/g, " ")}</Badge>
                          {c.risk_rating && <Badge variant="outline" className="capitalize">{c.risk_rating}</Badge>}
                          {canWrite && (
                            <div className="ml-auto flex gap-2">
                              <Button size="sm" variant="outline" onClick={() => { setActiveCpCase(c); setReqDialogOpen(true); }}>
                                <Plus className="mr-1 h-3 w-3" /> Request
                              </Button>
                              <Button size="icon" variant="ghost" onClick={async () => {
                                if (!confirm("Delete this dossier?")) return;
                                await amlTransactionsApi.deleteCpCase(c.id);
                                loadTransactions();
                              }}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                        {c.notes && <p className="mt-1 text-xs text-muted-foreground">{c.notes}</p>}
                        {requests.length > 0 && (
                          <ul className="mt-3 space-y-2">
                            {requests.map((r) => (
                              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded border-l-2 border-primary/40 bg-muted/30 p-2 text-xs">
                                <span className="font-medium">{r.request_type}</span>
                                <span className="text-muted-foreground">· {r.summary}</span>
                                <Badge variant="outline" className="ml-auto capitalize">{r.status.replace(/_/g, " ")}</Badge>
                                {r.due_date && <span className="text-muted-foreground">due {r.due_date}</span>}
                                {canWrite && r.status !== "resolved" && (
                                  <Button size="sm" variant="ghost" onClick={async () => {
                                    await amlTransactionsApi.resolveCpRequest(r.id, "resolved");
                                    loadTransactions();
                                  }}>Resolve</Button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="obligations" className="space-y-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-primary" />
                      AUSTRAC reportable obligations ({obligations.length})
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Automatically evaluated on every save. TTR ≥ AUD 10k cash · IFTI international · SMR high-risk / manual · structuring pattern.
                    </p>
                  </div>
                  {canWrite && (
                    <Button size="sm" variant="outline" disabled={reevaluating} onClick={runEvaluate}>
                      <RefreshCw className={`mr-1 h-3 w-3 ${reevaluating ? "animate-spin" : ""}`} /> Re-evaluate
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-2">
                  {obligations.length === 0 ? (
                    <AmlEmptyState body="No reportable obligations detected for this transaction. Obligations are evaluated automatically on every save — use Re-evaluate to check again now." />
                  ) : obligations.map((o) => {
                    const kindLabel: Record<AmlObligationKind, string> = {
                      ttr: "TTR (Threshold Transaction Report)",
                      ifti: "IFTI (International Funds Transfer Instruction)",
                      smr_candidate: "SMR candidate (Suspicious Matter)",
                      structuring_suspected: "Structuring pattern suspected",
                    };
                    return (
                      <div key={o.id} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{kindLabel[o.kind] ?? o.kind}</p>
                          <Badge variant="outline" className={`capitalize ${OBLIGATION_STATUS_TONE[o.status] ?? ""}`}>
                            {o.status.replace(/_/g, " ")}
                          </Badge>
                          {o.observed_amount != null && (
                            <span className="text-xs text-muted-foreground">
                              Observed: AUD {o.observed_amount.toLocaleString('en-AU')}
                              {o.threshold_amount != null && ` / threshold AUD ${o.threshold_amount.toLocaleString('en-AU')}`}
                            </span>
                          )}
                          <span className="ml-auto text-xs text-muted-foreground">
                            {new Date(o.created_at).toLocaleString('en-AU')}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">Reason: {o.trigger_reason.replace(/_/g, " ")}</p>
                        {o.waive_reason && <p className="mt-1 text-xs text-muted-foreground">Waived: {o.waive_reason}</p>}
                        {canWrite && o.status === "pending" && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={async () => {
                              await amlTransactionsApi.acknowledgeObligation(o.id);
                              toast.success("Obligation acknowledged");
                              reloadObligations();
                            }}>
                              <CheckCircle2 className="mr-1 h-3 w-3" /> Acknowledge
                            </Button>
                            <Button size="sm" variant="outline" onClick={async () => {
                              const reason = window.prompt("Reason for waiving this obligation (required):");
                              if (!reason?.trim()) return;
                              await amlTransactionsApi.waiveObligation(o.id, reason.trim());
                              toast.success("Obligation waived");
                              reloadObligations();
                            }}>
                              Waive
                            </Button>
                            <Button size="sm" variant="outline" onClick={async () => {
                              const reportId = window.prompt("AUSTRAC report reference (optional):") ?? null;
                              await amlTransactionsApi.linkObligationReport(o.id, reportId);
                              toast.success("Linked to report");
                              reloadObligations();
                            }}>
                              <FileText className="mr-1 h-3 w-3" /> Link report
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="events" className="space-y-3">
              <Card>
                <CardHeader className="flex flex-row items-center gap-2">
                  <ScrollText className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">Hash-chained timeline</CardTitle>
                </CardHeader>
                <CardContent>
                  {events.length === 0 ? (
                    <AmlEmptyState body="No events yet. Timeline entries are appended automatically as the transaction is created and updated." />
                  ) : (
                    <ol className="space-y-2">
                      {events.map((e) => (
                        <li key={e.id} className="rounded border p-2 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{e.category}</span>
                            <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString('en-AU')}</span>
                          </div>
                          <p>{e.summary}</p>
                          {e.actor_label && <p className="text-muted-foreground">by {e.actor_label}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
      </div>

      {/* Transaction dialog */}
      <TransactionDialog
        open={txDialogOpen} onOpenChange={setTxDialogOpen}
        caseId={caseId}
        initial={selectedTx}
        purchaseFileHint={currentCase?.purchase_file_id ?? null}
        onSaved={(tx) => { setSelectedTx(tx); loadTransactions(); }}
      />
      <PartyDialog
        open={partyDialogOpen} onOpenChange={setPartyDialogOpen}
        transactionId={selectedTx?.id ?? ""} caseId={caseId}
        onSaved={async () => { const { parties: p } = await amlTransactionsApi.listParties(selectedTx!.id); setParties(p); }}
      />
      <CpCaseDialog
        open={cpDialogOpen} onOpenChange={setCpDialogOpen}
        caseId={caseId} transactionId={selectedTx?.id ?? null}
        onSaved={loadTransactions}
      />
      <CpRequestDialog
        open={reqDialogOpen} onOpenChange={setReqDialogOpen}
        counterpartyCase={activeCpCase}
        onSaved={loadTransactions}
      />
    </div>
  );
}

// ============ Dialogs ============

function TransactionDialog({
  open, onOpenChange, caseId, initial, purchaseFileHint, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; caseId: string;
  initial: AmlTransaction | null; purchaseFileHint: string | null;
  onSaved: (tx: AmlTransaction) => void;
}) {
  const [form, setForm] = useState<Partial<AmlTransaction>>({});
  useEffect(() => {
    if (open) setForm(initial ?? { case_id: caseId, purchase_file_id: purchaseFileHint, kind: "purchase", status: "draft", currency: "AUD" });
  }, [open, initial, caseId, purchaseFileHint]);

  const save = async () => {
    if (!caseId) return;
    try {
      const { transaction } = await amlTransactionsApi.upsertTransaction({ ...form, case_id: caseId });
      toast.success("Transaction saved");
      onOpenChange(false); onSaved(transaction);
    } catch (e: any) { toast.error(e?.message ?? "Failed to save"); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{initial ? "Edit" : "Create"} transaction</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Kind</Label>
              <Select value={form.kind ?? "purchase"} onValueChange={(v) => setForm({ ...form, kind: v as AmlTransactionKind })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TX_KINDS.map((k) => <SelectItem key={k} value={k}>{k.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status ?? "draft"} onValueChange={(v) => setForm({ ...form, status: v as AmlTransactionStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TX_STATUSES.map((k) => <SelectItem key={k} value={k}>{k.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Reference</Label><Input value={form.reference ?? ""} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
          <div><Label>Property address</Label><Input value={form.property_address ?? ""} onChange={(e) => setForm({ ...form, property_address: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Contract date</Label><Input type="date" value={form.contract_date ?? ""} onChange={(e) => setForm({ ...form, contract_date: e.target.value || null })} /></div>
            <div><Label>Settlement date</Label><Input type="date" value={form.settlement_date ?? ""} onChange={(e) => setForm({ ...form, settlement_date: e.target.value || null })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Purchase price</Label><Input type="number" value={form.purchase_price ?? ""} onChange={(e) => setForm({ ...form, purchase_price: e.target.value ? Number(e.target.value) : null })} /></div>
            <div><Label>Deposit</Label><Input type="number" value={form.deposit_amount ?? ""} onChange={(e) => setForm({ ...form, deposit_amount: e.target.value ? Number(e.target.value) : null })} /></div>
          </div>
          <div><Label>Purchase file ID (optional)</Label><Input value={form.purchase_file_id ?? ""} onChange={(e) => setForm({ ...form, purchase_file_id: e.target.value || null })} /></div>
          <div><Label>Notes</Label><Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PartyDialog({
  open, onOpenChange, transactionId, caseId, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; transactionId: string; caseId: string; onSaved: () => void; }) {
  const [form, setForm] = useState<Partial<AmlTransactionParty>>({ party_type: "seller" });
  useEffect(() => { if (open) setForm({ party_type: "seller", transaction_id: transactionId, case_id: caseId }); }, [open, transactionId, caseId]);
  const save = async () => {
    if (!form.display_name) return toast.error("Display name required");
    try {
      await amlTransactionsApi.upsertParty({
        transaction_id: transactionId, case_id: caseId,
        display_name: form.display_name!, party_type: form.party_type as AmlPartyType,
        capacity: form.capacity ?? null, external_reference: form.external_reference ?? null,
      });
      toast.success("Party added"); onOpenChange(false); onSaved();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add party</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Display name</Label><Input value={form.display_name ?? ""} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
          <div>
            <Label>Type</Label>
            <Select value={form.party_type} onValueChange={(v) => setForm({ ...form, party_type: v as AmlPartyType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PARTY_TYPES.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Capacity / role</Label><Input value={form.capacity ?? ""} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
          <div><Label>External reference</Label><Input value={form.external_reference ?? ""} onChange={(e) => setForm({ ...form, external_reference: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CpCaseDialog({
  open, onOpenChange, caseId, transactionId, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; caseId: string; transactionId: string | null; onSaved: () => void; }) {
  const [form, setForm] = useState<Partial<AmlCounterpartyCase>>({ subject_type: "individual", status: "open" });
  useEffect(() => { if (open) setForm({ subject_type: "individual", status: "open", transaction_id: transactionId }); }, [open, transactionId]);
  const save = async () => {
    if (!form.subject_display_name) return toast.error("Subject name required");
    try {
      await amlTransactionsApi.upsertCpCase({
        case_id: caseId, subject_display_name: form.subject_display_name!,
        subject_type: form.subject_type ?? "individual",
        transaction_id: transactionId, notes: form.notes ?? null, risk_rating: form.risk_rating ?? null,
      });
      toast.success("Counterparty dossier created"); onOpenChange(false); onSaved();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New counterparty dossier</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Subject name</Label><Input value={form.subject_display_name ?? ""} onChange={(e) => setForm({ ...form, subject_display_name: e.target.value })} /></div>
          <div>
            <Label>Subject type</Label>
            <Select value={form.subject_type} onValueChange={(v) => setForm({ ...form, subject_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["individual", "company", "trust", "smsf", "partnership", "other"].map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Risk rating</Label>
            <Select value={form.risk_rating ?? "unassigned"} onValueChange={(v) => setForm({ ...form, risk_rating: v === "unassigned" ? null : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {["low", "medium", "high", "prohibited"].map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Notes</Label><Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CpRequestDialog({
  open, onOpenChange, counterpartyCase, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; counterpartyCase: AmlCounterpartyCase | null; onSaved: () => void; }) {
  const [form, setForm] = useState<Partial<AmlCounterpartyRequest>>({ request_type: "identity", channel: "email", status: "pending" });
  useEffect(() => { if (open) setForm({ request_type: "identity", channel: "email", status: "pending" }); }, [open]);
  const save = async () => {
    if (!counterpartyCase) return;
    if (!form.summary) return toast.error("Summary required");
    try {
      await amlTransactionsApi.upsertCpRequest({
        counterparty_case_id: counterpartyCase.id,
        case_id: counterpartyCase.case_id,
        request_type: form.request_type ?? "identity",
        channel: form.channel ?? "email",
        status: (form.status as AmlCpRequestStatus) ?? "pending",
        summary: form.summary!,
        detail: form.detail ?? null,
        due_date: form.due_date ?? null,
      });
      toast.success("Request created"); onOpenChange(false); onSaved();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New counterparty request</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Type</Label>
            <Select value={form.request_type} onValueChange={(v) => setForm({ ...form, request_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CP_REQUEST_TYPES.map((k) => <SelectItem key={k} value={k}>{k.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Summary</Label><Input value={form.summary ?? ""} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></div>
          <div><Label>Detail</Label><Textarea value={form.detail ?? ""} onChange={(e) => setForm({ ...form, detail: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Channel</Label>
              <Select value={form.channel ?? "email"} onValueChange={(v) => setForm({ ...form, channel: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["email", "phone", "sms", "post", "in_person", "portal"].map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Due date</Label><Input type="date" value={form.due_date ?? ""} onChange={(e) => setForm({ ...form, due_date: e.target.value || null })} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
