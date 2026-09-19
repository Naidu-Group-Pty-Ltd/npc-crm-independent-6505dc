import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ClipboardList, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useFinancePortalAuth } from "@/hooks/useFinancePortalAuth";

/** Finance-safe request row — exactly what the server projects (§15.1). */
interface PortalFinanceRequest {
  id: string;
  kind: "funding_information" | "financial_evidence" | "clarification";
  subject: string;
  message: string;
  status: "open" | "submitted" | "clarification_required" | "resolved" | "cancelled";
  purchase_file_id: string | null;
  created_at: string;
  responded_at: string | null;
}

const STATUS_META: Record<string, { label: string; tone: string }> = {
  open: { label: "Action required", tone: "bg-warning/15 text-warning" },
  clarification_required: { label: "Clarification required", tone: "bg-warning/15 text-warning" },
  submitted: { label: "Submitted", tone: "bg-primary/15 text-primary" },
  resolved: { label: "Completed", tone: "bg-success/15 text-success" },
  cancelled: { label: "Withdrawn", tone: "bg-muted text-muted-foreground" },
};

const KIND_LABELS: Record<string, string> = {
  funding_information: "Funding information",
  financial_evidence: "Financial evidence",
  clarification: "Clarification",
};

interface FundingForm {
  purchase_price?: string; loan_amount?: string; lender?: string; lvr?: string;
  borrower_contribution?: string; refi_equity?: string; gift_amount?: string;
  gift_source?: string; smsf_lrba?: boolean; loan_purpose?: string; funding_notes?: string;
}

/**
 * Phase 7 — the broker's AML information-request inbox for one purchase file.
 * Deliberately limited: shows only the compliance team's finance-safe request
 * wording, and sends back funding figures, evidence descriptions or
 * clarification text. No case detail, risk or screening information exists in
 * this channel.
 */
export function AmlFinanceRequestsCard({ purchaseFileId }: { purchaseFileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PortalFinanceRequest[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [funding, setFunding] = useState<FundingForm>({});
  const [replyText, setReplyText] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await invokeFinanceFunction("finance-portal-aml-requests", {
        op: "list", purchase_file_id: purchaseFileId,
      });
      if (error) throw new Error(error.message ?? String(error));
      setRequests(data?.requests ?? []);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [invokeFinanceFunction, purchaseFileId]);

  useEffect(() => { void load(); }, [load]);

  const submitFunding = async (requestId: string) => {
    setBusy(true);
    try {
      const { data, error } = await invokeFinanceFunction("finance-portal-aml-requests", {
        op: "submit",
        request_id: requestId,
        funding: {
          purchase_price: funding.purchase_price || null,
          loan_amount: funding.loan_amount || null,
          lender: funding.lender || null,
          lvr: funding.lvr || null,
          borrower_contribution: funding.borrower_contribution || null,
          refi_equity: funding.refi_equity || null,
          gift_amount: funding.gift_amount || null,
          gift_source: funding.gift_source || null,
          smsf_lrba: Boolean(funding.smsf_lrba),
          loan_purpose: funding.loan_purpose || null,
          funding_notes: funding.funding_notes || null,
        },
      });
      if (error || data?.error) throw new Error(data?.error ?? error?.message ?? "Submission failed");
      toast({ title: "Funding information submitted", description: "The compliance team will be in touch if anything needs clarifying." });
      setActiveId(null); setFunding({});
      await load();
    } catch (e: any) {
      toast({ title: "Could not submit", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const submitReply = async (requestId: string) => {
    setBusy(true);
    try {
      const evidence = evidenceNote.trim()
        ? evidenceNote.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 10).map((label) => ({ label }))
        : [];
      const { data, error } = await invokeFinanceFunction("finance-portal-aml-requests", {
        op: "respond", request_id: requestId, message: replyText.trim(), evidence,
      });
      if (error || data?.error) throw new Error(data?.error ?? error?.message ?? "Response failed");
      toast({ title: "Response sent" });
      setActiveId(null); setReplyText(""); setEvidenceNote("");
      await load();
    } catch (e: any) {
      toast({ title: "Could not send response", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const actionable = requests.filter((r) => r.status === "open" || r.status === "clarification_required");

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ClipboardList className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm">Compliance information requests</CardTitle>
            <CardDescription className="text-xs">
              Funding details and evidence the compliance team has asked for on this file
            </CardDescription>
          </div>
          {actionable.length > 0 && (
            <Badge className="ml-auto bg-warning/15 text-warning">{actionable.length} to action</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : requests.length === 0 ? (
          <p className="text-xs text-muted-foreground">No information requests for this file.</p>
        ) : (
          <ul className="space-y-3">
            {requests.map((r) => {
              const meta = STATUS_META[r.status] ?? STATUS_META.open;
              const open = r.status === "open" || r.status === "clarification_required";
              const expanded = activeId === r.id;
              return (
                <li key={r.id} className="rounded-md border border-border/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{r.subject}</div>
                      <div className="text-xs text-muted-foreground">
                        {KIND_LABELS[r.kind] ?? r.kind} · {new Date(r.created_at).toLocaleDateString('en-AU')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={meta.tone}>{meta.label}</Badge>
                      {open && (
                        <Button size="sm" variant="outline" onClick={() => setActiveId(expanded ? null : r.id)}>
                          {expanded ? "Close" : "Respond"}
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{r.message}</p>

                  {expanded && r.kind === "funding_information" && (
                    <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div><Label className="text-xs">Purchase price (AUD)</Label>
                          <Input type="number" inputMode="numeric" value={funding.purchase_price ?? ""} onChange={(e) => setFunding({ ...funding, purchase_price: e.target.value })} /></div>
                        <div><Label className="text-xs">Loan amount (AUD)</Label>
                          <Input type="number" inputMode="numeric" value={funding.loan_amount ?? ""} onChange={(e) => setFunding({ ...funding, loan_amount: e.target.value })} /></div>
                        <div><Label className="text-xs">Lender</Label>
                          <Input value={funding.lender ?? ""} onChange={(e) => setFunding({ ...funding, lender: e.target.value })} /></div>
                        <div><Label className="text-xs">LVR (%)</Label>
                          <Input type="number" step="0.1" inputMode="decimal" value={funding.lvr ?? ""} onChange={(e) => setFunding({ ...funding, lvr: e.target.value })} /></div>
                        <div><Label className="text-xs">Borrower contribution (AUD)</Label>
                          <Input type="number" inputMode="numeric" value={funding.borrower_contribution ?? ""} onChange={(e) => setFunding({ ...funding, borrower_contribution: e.target.value })} /></div>
                        <div><Label className="text-xs">Refinance equity (AUD)</Label>
                          <Input type="number" inputMode="numeric" value={funding.refi_equity ?? ""} onChange={(e) => setFunding({ ...funding, refi_equity: e.target.value })} /></div>
                        <div><Label className="text-xs">Gift amount (AUD)</Label>
                          <Input type="number" inputMode="numeric" value={funding.gift_amount ?? ""} onChange={(e) => setFunding({ ...funding, gift_amount: e.target.value })} /></div>
                        <div><Label className="text-xs">Gift source (who is giving it)</Label>
                          <Input value={funding.gift_source ?? ""} onChange={(e) => setFunding({ ...funding, gift_source: e.target.value })} /></div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={Boolean(funding.smsf_lrba)} onCheckedChange={(v) => setFunding({ ...funding, smsf_lrba: v })} />
                        <Label className="text-xs">SMSF limited recourse borrowing arrangement (LRBA)</Label>
                      </div>
                      <div><Label className="text-xs">Notes for the compliance team</Label>
                        <Textarea rows={2} value={funding.funding_notes ?? ""} onChange={(e) => setFunding({ ...funding, funding_notes: e.target.value })} /></div>
                      <Button size="sm" disabled={busy || (!funding.purchase_price && !funding.loan_amount)} onClick={() => submitFunding(r.id)}>
                        {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                        Submit funding information
                      </Button>
                    </div>
                  )}

                  {expanded && r.kind !== "funding_information" && (
                    <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
                      <div><Label className="text-xs">Your response</Label>
                        <Textarea rows={3} value={replyText} onChange={(e) => setReplyText(e.target.value)} /></div>
                      {r.kind === "financial_evidence" && (
                        <div>
                          <Label className="text-xs">Evidence provided (one item per line, e.g. "Loan approval letter — ANZ, 12 Jul")</Label>
                          <Textarea rows={2} value={evidenceNote} onChange={(e) => setEvidenceNote(e.target.value)} />
                        </div>
                      )}
                      <Button size="sm" disabled={busy || (!replyText.trim() && !evidenceNote.trim())} onClick={() => submitReply(r.id)}>
                        {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                        Send response
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
