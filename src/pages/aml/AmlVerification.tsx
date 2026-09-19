import { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck, PlayCircle, XCircle, CheckCircle2, AlertTriangle, HelpCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";
import { amlVerificationApi, type IdentityCheck, type IdvStatus } from "@/lib/aml/amlVerificationApi";
import { LegacyAliasBanner } from "@/components/aml/LegacyAliasBanner";
import {
  AmlMetricCard,
  AmlPageHeader,
  AmlRefreshButton,
  AmlTableEmptyRow,
  AmlTableLoadingRow,
} from "@/components/aml/primitives";

const STATUS_TONE: Record<IdvStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-primary/15 text-primary",
  verified: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
  expired: "bg-muted text-muted-foreground",
  manual_review: "bg-warning/15 text-warning",
  cancelled: "bg-muted text-muted-foreground",
};

const STATUS_ICON: Record<IdvStatus, JSX.Element> = {
  pending: <HelpCircle className="h-3 w-3" />,
  in_progress: <Loader2 className="h-3 w-3 animate-spin" />,
  verified: <CheckCircle2 className="h-3 w-3" />,
  failed: <XCircle className="h-3 w-3" />,
  expired: <HelpCircle className="h-3 w-3" />,
  manual_review: <AlertTriangle className="h-3 w-3" />,
  cancelled: <XCircle className="h-3 w-3" />,
};

export default function AmlVerification() {
  const [cases, setCases] = useState<AmlCase[]>([]);
  const [checks, setChecks] = useState<IdentityCheck[]>([]);
  const [caseId, setCaseId] = useState<string>("");
  const [method, setMethod] = useState("document_and_liveness");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const loadCases = async () => {
    try {
      const res = await amlCasesApi.list({ limit: 200 });
      setCases(res.cases);
      if (!caseId && res.cases[0]) setCaseId(res.cases[0].id);
    } catch (e: any) { toast.error(e?.message ?? "Failed to load cases"); }
  };

  const loadChecks = async (cid?: string) => {
    setLoading(true);
    try {
      const res = await amlVerificationApi.listIdv(cid || undefined);
      setChecks(res.identity_checks);
    } catch (e: any) { toast.error(e?.message ?? "Failed to load IDV runs"); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadCases(); }, []);
  useEffect(() => { loadChecks(caseId); }, [caseId]);

  const kpis = useMemo(() => {
    const total = checks.length;
    const verified = checks.filter((c) => c.status === "verified").length;
    const review = checks.filter((c) => c.status === "manual_review").length;
    const failed = checks.filter((c) => c.status === "failed").length;
    return { total, verified, review, failed, pct: total ? Math.round((verified / total) * 100) : 0 };
  }, [checks]);

  const run = async () => {
    if (!caseId) { toast.error("Select a case first"); return; }
    setRunning(true);
    try {
      const res = await amlVerificationApi.initiateIdv(caseId, method);
      toast.success(`IDV ${res.identity_check.status} • score ${(res.identity_check.overall_score ?? 0).toFixed(2)}`);
      await loadChecks(caseId);
    } catch (e: any) { toast.error(e?.message ?? "IDV failed"); }
    finally { setRunning(false); }
  };

  const cancel = async (id: string) => {
    try { await amlVerificationApi.cancelIdv(id); await loadChecks(caseId); }
    catch (e: any) { toast.error(e?.message ?? "Cancel failed"); }
  };

  return (
    <div className="space-y-6">
      <LegacyAliasBanner label="Verification" tabHint="verification" routePath="/admin/aml/verification" />
      <AmlPageHeader
        title="Identity Verification"
        description="Provider-agnostic IDV runs with tamper-evident audit and Mission Control metering."
        icon={ShieldCheck}
        actions={<AmlRefreshButton onClick={() => loadChecks(caseId)} loading={loading} />}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <AmlMetricCard title="Runs (scope)" state={loading ? "loading" : "ready"} value={kpis.total} />
        <AmlMetricCard title="Verified" state={loading ? "loading" : "ready"} value={kpis.verified} />
        <AmlMetricCard title="Manual review" state={loading ? "loading" : "ready"} value={kpis.review} />
        <AmlMetricCard title="Failed" state={loading ? "loading" : "ready"} value={kpis.failed} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Initiate verification</CardTitle>
          <CardDescription>Runs via the configured provider (simulator by default). Each call reserves &amp; commits Mission Control tokens.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row md:items-end gap-3">
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
          <div className="w-full md:w-[260px]">
            <label className="text-xs text-muted-foreground">Method</label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="document_and_liveness">Document + Liveness</SelectItem>
                <SelectItem value="document_only">Document only</SelectItem>
                <SelectItem value="database_lookup">Database lookup</SelectItem>
                <SelectItem value="manual">Manual (analyst review)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={run} disabled={running || !caseId}>
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
            Run IDV
          </Button>
        </CardContent>
      </Card>

      {/*
        Two verification paths exist and they are easy to confuse. This page
        runs staff-initiated IDV against the configured provider. The
        portal-captured, per-party checks — the ones with the three-attempt
        ceiling and the retained biometric — are adjudicated in the case
        workspace, so say so rather than letting this page read as the whole
        picture.
      */}
      <Alert>
        <HelpCircle className="h-4 w-4" aria-hidden="true" />
        <AlertDescription>
          Identity checks captured by clients in the portal are adjudicated per party in
          the case workspace, under <span className="font-medium">Verification</span> —
          including document sightings, retained facial images and the three-attempt limit.
          This page covers staff-initiated runs only.
        </AlertDescription>
      </Alert>

      {kpis.total > 0 && (
        <Alert>
          <AlertDescription>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Verified pass-rate</span>
              <Progress value={kpis.pct} className="h-2 flex-1" />
              <span className="text-xs font-medium">{kpis.pct}%</span>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader><CardTitle>Recent runs</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table aria-label="Recent IDV runs">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Subject</TableHead>
                <TableHead scope="col">Provider</TableHead>
                <TableHead scope="col">Method</TableHead>
                <TableHead scope="col">Score</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Requested</TableHead>
                <TableHead scope="col" className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <AmlTableLoadingRow colSpan={7} label="Loading IDV runs…" />
              )}
              {!loading && checks.length === 0 && (
                <AmlTableEmptyRow colSpan={7}>
                  No IDV runs yet for this case. Initiate a verification above to record the first run.
                </AmlTableEmptyRow>
              )}
              {checks.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.subject_label}</TableCell>
                  <TableCell><Badge variant="outline">{c.provider}</Badge></TableCell>
                  <TableCell className="text-xs">{c.method}</TableCell>
                  <TableCell>{c.overall_score != null ? c.overall_score.toFixed(2) : "—"}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${STATUS_TONE[c.status]}`}>
                      {STATUS_ICON[c.status]} {c.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(c.requested_at).toLocaleString('en-AU')}</TableCell>
                  <TableCell className="text-right">
                    {(c.status === "pending" || c.status === "in_progress") && (
                      <Button size="sm" variant="ghost" onClick={() => cancel(c.id)}>Cancel</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
