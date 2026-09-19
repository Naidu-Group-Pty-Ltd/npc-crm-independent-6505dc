import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, PlayCircle, ShieldAlert, ShieldCheck, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";
import { amlVerificationApi, type ScreeningCheck, type ScreeningMatch, type ScreeningScope } from "@/lib/aml/amlVerificationApi";
import { LegacyAliasBanner } from "@/components/aml/LegacyAliasBanner";
import {
  AmlMetricCard,
  AmlPageHeader,
  AmlRefreshButton,
  AmlTableEmptyRow,
  AmlTableLoadingRow,
} from "@/components/aml/primitives";

const ALL_SCOPES: { value: ScreeningScope; label: string }[] = [
  { value: "pep", label: "PEP" },
  { value: "sanctions", label: "Sanctions" },
  { value: "adverse_media", label: "Adverse media" },
  { value: "watchlist", label: "Watchlists" },
];

const MATCH_TYPE_TONE: Record<string, string> = {
  sanctions: "bg-destructive/15 text-destructive",
  pep: "bg-warning/15 text-warning",
  adverse_media: "bg-primary/15 text-primary",
  watchlist: "bg-muted text-muted-foreground",
  other: "bg-muted text-muted-foreground",
};

export default function AmlScreening() {
  const [cases, setCases] = useState<AmlCase[]>([]);
  const [checks, setChecks] = useState<ScreeningCheck[]>([]);
  const [matches, setMatches] = useState<ScreeningMatch[]>([]);
  const [caseId, setCaseId] = useState<string>("");
  const [scope, setScope] = useState<ScreeningScope[]>(["pep", "sanctions", "adverse_media"]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<ScreeningMatch | null>(null);
  const [disposition, setDisposition] = useState<"confirmed" | "dismissed" | "escalated">("dismissed");
  const [rationale, setRationale] = useState("");

  const loadCases = async () => {
    try {
      const res = await amlCasesApi.list({ limit: 200 });
      setCases(res.cases);
      if (!caseId && res.cases[0]) setCaseId(res.cases[0].id);
    } catch (e: any) { toast.error(e?.message ?? "Failed to load cases"); }
  };

  const loadAll = async (cid?: string) => {
    setLoading(true);
    try {
      const [c, m] = await Promise.all([
        amlVerificationApi.listScreening(cid || undefined),
        amlVerificationApi.listMatches({ case_id: cid || undefined, status: "open" }),
      ]);
      setChecks(c.screening_checks);
      setMatches(m.matches);
    } catch (e: any) { toast.error(e?.message ?? "Failed to load screening"); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadCases(); }, []);
  useEffect(() => { loadAll(caseId); }, [caseId]);

  const kpis = useMemo(() => {
    const total = checks.length;
    const clear = checks.filter((c) => c.status === "clear").length;
    const matched = checks.filter((c) => c.status === "matched").length;
    return { total, clear, matched, openMatches: matches.length };
  }, [checks, matches]);

  const toggleScope = (s: ScreeningScope) =>
    setScope((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);

  const run = async () => {
    if (!caseId) { toast.error("Select a case first"); return; }
    if (scope.length === 0) { toast.error("Select at least one scope"); return; }
    setRunning(true);
    try {
      const res = await amlVerificationApi.runScreening(caseId, scope);
      toast.success(`Screening ${res.screening_check.status} • ${res.result?.matches?.length ?? 0} match(es)`);
      await loadAll(caseId);
    } catch (e: any) { toast.error(e?.message ?? "Screening failed"); }
    finally { setRunning(false); }
  };

  const submitResolve = async () => {
    if (!resolveTarget) return;
    if (rationale.trim().length < 3) { toast.error("Rationale is required"); return; }
    try {
      await amlVerificationApi.resolveMatch(resolveTarget.id, disposition, rationale.trim());
      toast.success(`Match ${disposition}`);
      setResolveTarget(null); setRationale(""); setDisposition("dismissed");
      await loadAll(caseId);
    } catch (e: any) { toast.error(e?.message ?? "Resolution failed"); }
  };

  return (
    <div className="space-y-6">
      <LegacyAliasBanner label="Screening" tabHint="screening" routePath="/admin/aml/screening" />
      <AmlPageHeader
        title="PEP & Sanctions Screening"
        description="Screening runs, hit queue, and MLRO-signed dispositions."
        icon={Search}
        actions={<AmlRefreshButton onClick={() => loadAll(caseId)} loading={loading} />}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <AmlMetricCard title="Runs" state={loading ? "loading" : "ready"} value={kpis.total} />
        <AmlMetricCard title="Clear" state={loading ? "loading" : "ready"} value={kpis.clear} />
        <AmlMetricCard title="Matched" state={loading ? "loading" : "ready"} value={kpis.matched} />
        <AmlMetricCard title="Open matches" state={loading ? "loading" : "ready"} value={kpis.openMatches} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Run screening</CardTitle>
          <CardDescription>Simulator provider by default. Real screening providers are enabled in environment configuration.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex-1 min-w-[240px]">
            <label className="text-xs text-muted-foreground">Case</label>
            <Select value={caseId} onValueChange={setCaseId}>
              <SelectTrigger><SelectValue placeholder="Select a case" /></SelectTrigger>
              <SelectContent>
                {cases.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.case_reference} — {c.subject_display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-3">
            {ALL_SCOPES.map((s) => (
              <label key={s.value} className="flex items-center gap-2 text-sm">
                <Checkbox checked={scope.includes(s.value)} onCheckedChange={() => toggleScope(s.value)} />
                {s.label}
              </label>
            ))}
          </div>
          <Button onClick={run} disabled={running || !caseId}>
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
            Run screening
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-destructive" /> Match resolution queue</CardTitle>
          <CardDescription>Open hits awaiting analyst / MLRO disposition. Every decision is hash-chained.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table aria-label="Match resolution queue">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Name</TableHead>
                <TableHead scope="col">Type</TableHead>
                <TableHead scope="col">List</TableHead>
                <TableHead scope="col">Score</TableHead>
                <TableHead scope="col">Jurisdiction</TableHead>
                <TableHead scope="col">Found</TableHead>
                <TableHead scope="col" className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && matches.length === 0 && (
                <AmlTableLoadingRow colSpan={7} label="Loading matches…" />
              )}
              {!loading && matches.length === 0 && (
                <AmlTableEmptyRow colSpan={7}>
                  No open matches for this case. Run screening above to check for new hits.
                </AmlTableEmptyRow>
              )}
              {matches.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.matched_name}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${MATCH_TYPE_TONE[m.match_type] ?? ""}`}>
                      {m.match_type}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">{m.list_name ?? "—"}</TableCell>
                  <TableCell>{m.score != null ? m.score.toFixed(2) : "—"}</TableCell>
                  <TableCell className="text-xs">{m.jurisdiction ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString('en-AU')}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => { setResolveTarget(m); setDisposition("dismissed"); setRationale(""); }}>
                      Resolve
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-success" /> Recent screening runs</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table aria-label="Recent screening runs">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Subject</TableHead>
                <TableHead scope="col">Provider</TableHead>
                <TableHead scope="col">Scope</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Matches</TableHead>
                <TableHead scope="col">Run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && checks.length === 0 && (
                <AmlTableLoadingRow colSpan={6} label="Loading screening runs…" />
              )}
              {!loading && checks.length === 0 && (
                <AmlTableEmptyRow colSpan={6}>
                  No runs yet. Select a case and run screening to record the first check.
                </AmlTableEmptyRow>
              )}
              {checks.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.subject_label}</TableCell>
                  <TableCell><Badge variant="outline">{c.provider}</Badge></TableCell>
                  <TableCell className="text-xs">{(c.scope ?? []).join(", ")}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === "clear" ? "secondary" : c.status === "matched" ? "destructive" : "outline"}>
                      {c.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{(c.result_summary as any)?.match_count ?? 0}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(c.requested_at).toLocaleString('en-AU')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!resolveTarget} onOpenChange={(open) => !open && setResolveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" /> Resolve match</DialogTitle>
            <DialogDescription>{resolveTarget?.matched_name} — {resolveTarget?.list_name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Disposition</label>
              <Select value={disposition} onValueChange={(v: any) => setDisposition(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dismissed">Dismiss (false positive)</SelectItem>
                  <SelectItem value="confirmed">Confirm (true match)</SelectItem>
                  <SelectItem value="escalated">Escalate to MLRO</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Rationale (required)</label>
              <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={4}
                placeholder="Explain the basis for this decision. This is written to the tamper-evident audit chain." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResolveTarget(null)}>Cancel</Button>
            <Button onClick={submitResolve}>Record decision</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
