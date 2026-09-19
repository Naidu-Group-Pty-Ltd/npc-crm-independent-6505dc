import { useEffect, useMemo, useState } from "react";
import { Loader2, Gauge, PlayCircle, ShieldAlert, CheckCircle2, XCircle, AlertTriangle, ThumbsUp, ThumbsDown, PlusCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";
import { amlRiskApi, type AmlRiskFactor, type AmlMandatoryTrigger, type AmlRiskAssessment, type AmlCaseCondition, type AmlDecision } from "@/lib/aml/amlRiskApi";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { LegacyAliasBanner } from "@/components/aml/LegacyAliasBanner";
import {
  AmlLoadingState,
  AmlPageHeader,
  AmlTableEmptyRow,
} from "@/components/aml/primitives";

const RATING_TONE: Record<string, string> = {
  low: "bg-success/15 text-success",
  medium: "bg-warning/15 text-warning",
  high: "bg-destructive/15 text-destructive",
  prohibited: "bg-destructive text-destructive-foreground",
};

export default function AmlRisk() {
  const { isMlro, canWrite } = useAmlAccess();
  const [cases, setCases] = useState<AmlCase[]>([]);
  const [caseId, setCaseId] = useState<string>("");
  const [factors, setFactors] = useState<AmlRiskFactor[]>([]);
  const [triggers, setTriggers] = useState<AmlMandatoryTrigger[]>([]);
  const [inputs, setInputs] = useState<Record<string, any>>({});
  const [latest, setLatest] = useState<AmlRiskAssessment | null>(null);
  const [history, setHistory] = useState<AmlRiskAssessment[]>([]);
  const [conditions, setConditions] = useState<AmlCaseCondition[]>([]);
  const [decision, setDecision] = useState<AmlDecision | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [decideOpen, setDecideOpen] = useState(false);
  const [decideOutcome, setDecideOutcome] = useState<AmlDecision["outcome"]>("cleared");
  const [decideRationale, setDecideRationale] = useState("");
  const [condLabel, setCondLabel] = useState("");
  const [condDetail, setCondDetail] = useState("");

  useEffect(() => { (async () => {
    try {
      const [c, f, t] = await Promise.all([amlCasesApi.list({ limit: 200 }), amlRiskApi.listFactors(), amlRiskApi.listTriggers()]);
      setCases(c.cases); setFactors(f.factors); setTriggers(t.triggers);
      if (c.cases[0]) setCaseId(c.cases[0].id);
    } catch (e: any) { toast.error(e?.message ?? "Failed to load"); }
    finally { setLoading(false); }
  })(); }, []);

  useEffect(() => { if (caseId) refreshCase(); }, [caseId]);

  async function refreshCase() {
    try {
      const [h, cd, ld] = await Promise.all([
        amlRiskApi.listAssessments(caseId),
        amlRiskApi.listConditions(caseId),
        amlRiskApi.latestDecision(caseId),
      ]);
      setHistory(h.assessments); setLatest(h.assessments[0] ?? null);
      setConditions(cd.conditions); setDecision(ld.decision);
      if (h.assessments[0]) setInputs(h.assessments[0].inputs ?? {});
      else setInputs({});
    } catch (e: any) { toast.error(e?.message ?? "Failed to refresh"); }
  }

  async function runEvaluate() {
    if (!caseId) return;
    setBusy(true);
    try {
      const res = await amlRiskApi.evaluate(caseId, inputs);
      setLatest(res.assessment);
      toast.success(`Assessment recorded — ${res.assessment.risk_rating?.toUpperCase()}`);
      refreshCase();
    } catch (e: any) { toast.error(e?.message ?? "Evaluation failed"); }
    finally { setBusy(false); }
  }

  async function recordDecision() {
    setBusy(true);
    try {
      await amlRiskApi.decide({ case_id: caseId, assessment_id: latest?.id, outcome: decideOutcome, rationale: decideRationale });
      toast.success("Decision recorded (immutable snapshot).");
      setDecideOpen(false); setDecideRationale("");
      refreshCase();
    } catch (e: any) { toast.error(e?.message ?? "Failed to record decision"); }
    finally { setBusy(false); }
  }

  async function addCondition() {
    if (!condLabel.trim()) return;
    try {
      await amlRiskApi.upsertCondition({ case_id: caseId, label: condLabel.trim(), detail: condDetail.trim() || null });
      setCondLabel(""); setCondDetail(""); refreshCase();
    } catch (e: any) { toast.error(e?.message ?? "Failed to add condition"); }
  }

  const scoringKeys = useMemo(() => {
    const set = new Set<string>();
    for (const f of factors) Object.keys(f.scoring ?? {}).forEach((k) => set.add(k));
    return Array.from(set);
  }, [factors]);

  return (
    <div className="space-y-6">
      <LegacyAliasBanner label="Risk & Decision" tabHint="risk" routePath="/admin/aml/risk" />
      <AmlPageHeader
        title="Risk Assessment"
        description="Score the case against the configured risk factors, review any mandatory holds, and record decisions that cannot be changed later."
        icon={Gauge}
        actions={
          <div className="min-w-[280px]">
            <Select value={caseId} onValueChange={setCaseId}>
              <SelectTrigger aria-label="Select case"><SelectValue placeholder="Select a case" /></SelectTrigger>
              <SelectContent>
                {cases.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.case_reference} — {c.subject_display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {loading ? (
        <AmlLoadingState variant="list" lines={4} label="Loading risk factors and assessments…" />
      ) : (
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Inputs / factors */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Factor inputs</CardTitle>
            <CardDescription>Pick a value per factor — scoring bands come from configuration.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {factors.map((f) => {
              const opts = Object.keys(f.scoring ?? {});
              return (
                <div key={f.id} className="grid gap-2 md:grid-cols-[220px_1fr_auto] md:items-center">
                  <div>
                    <div className="text-sm font-medium">{f.label}</div>
                    <div className="text-xs text-muted-foreground">{f.category} · weight {f.weight}</div>
                  </div>
                  {opts.length > 0 ? (
                    <Select value={String(inputs[f.key] ?? "")} onValueChange={(v) => setInputs((p) => ({ ...p, [f.key]: v }))}>
                      <SelectTrigger><SelectValue placeholder="Not scored" /></SelectTrigger>
                      <SelectContent>
                        {opts.map((k) => <SelectItem key={k} value={k}>{k} · {f.scoring[k]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={String(inputs[f.key] ?? "")} onChange={(e) => setInputs((p) => ({ ...p, [f.key]: e.target.value }))} placeholder="0-100" />
                  )}
                  <div className="text-xs text-muted-foreground text-right">{inputs[f.key] ?? "—"}</div>
                </div>
              );
            })}
            {factors.length === 0 && <p className="text-sm text-muted-foreground">No active factors configured.</p>}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button onClick={runEvaluate} disabled={!caseId || busy || !canWrite}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                <span className="ml-2">Run assessment</span>
              </Button>
              {scoringKeys.length > 0 && (
                <span className="text-xs text-muted-foreground">Common values: {scoringKeys.slice(0, 10).join(", ")}</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Latest assessment */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest assessment</CardTitle>
            <CardDescription>Rating, blocking holds, and score bands.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!latest && <p className="text-sm text-muted-foreground">No assessment yet.</p>}
            {latest && (
              <>
                <div className="flex items-center gap-2">
                  <Badge className={RATING_TONE[latest.risk_rating ?? "low"] ?? ""}>{(latest.risk_rating ?? "?").toUpperCase()}</Badge>
                  <span className="text-xs text-muted-foreground">Computed {new Date(latest.created_at).toLocaleString('en-AU')}</span>
                </div>
                <div className="space-y-2">
                  <ScoreBar label="ML/TF" value={latest.mltf_score} />
                  <ScoreBar label="Completion" value={latest.completion_score} />
                  <ScoreBar label="Verification" value={latest.verification_score} />
                </div>
                {latest.triggered_holds.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase text-muted-foreground">Mandatory holds</div>
                    {latest.triggered_holds.map((h) => (
                      <Alert key={h.key} variant={h.severity === "block" ? "destructive" : "default"}>
                        <ShieldAlert className="h-4 w-4" />
                        <AlertTitle className="text-sm">{h.label}</AlertTitle>
                        <AlertDescription className="text-xs">Severity: {h.severity}</AlertDescription>
                      </Alert>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Dialog open={decideOpen} onOpenChange={setDecideOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="default" disabled={!isMlro && !canWrite}>Record decision</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Record immutable decision</DialogTitle></DialogHeader>
                      <div className="space-y-3">
                        <div>
                          <Label>Outcome</Label>
                          <Select value={decideOutcome} onValueChange={(v) => setDecideOutcome(v as any)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cleared">Cleared</SelectItem>
                              <SelectItem value="conditional">Conditional</SelectItem>
                              <SelectItem value="escalated">Escalated to MLRO</SelectItem>
                              <SelectItem value="blocked">Blocked</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Rationale</Label>
                          <Textarea value={decideRationale} onChange={(e) => setDecideRationale(e.target.value)} rows={4} />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="ghost" onClick={() => setDecideOpen(false)}>Cancel</Button>
                        <Button onClick={recordDecision} disabled={busy}>Save</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </>
            )}

            {decision && (
              <div className="rounded-md border border-border/60 p-3">
                <div className="text-xs uppercase text-muted-foreground">Latest decision</div>
                <div className="mt-1 text-sm font-medium capitalize">{decision.outcome}</div>
                {decision.rationale && <div className="text-xs text-muted-foreground mt-1">{decision.rationale}</div>}
                <div className="text-[10px] text-muted-foreground mt-2 font-mono truncate">hash {decision.snapshot_hash.slice(0, 24)}…</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      )}

      {/* Conditions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Case conditions</CardTitle>
          <CardDescription>Open items must be cleared before purchase-ready.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
            <Input placeholder="Condition label" value={condLabel} onChange={(e) => setCondLabel(e.target.value)} />
            <Input placeholder="Detail (optional)" value={condDetail} onChange={(e) => setCondDetail(e.target.value)} />
            <Button variant="outline" onClick={addCondition} disabled={!caseId || !canWrite}>
              <PlusCircle className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
          <Table aria-label="Case conditions">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Label</TableHead>
                  <TableHead scope="col">Detail</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col" className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conditions.length === 0 && (
                  <AmlTableEmptyRow colSpan={4}>
                    No conditions on this case. Add one above to track what must be cleared before purchase-ready.
                  </AmlTableEmptyRow>
                )}
                {conditions.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.label}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.detail || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === "open" ? "outline" : "secondary"}>{c.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {c.status === "open" && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Mark condition "${c.label}" as resolved`}
                            onClick={() => amlRiskApi.resolveCondition(c.id, "resolved").then(refreshCase)}
                          >
                            <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Waive condition "${c.label}"`}
                            onClick={() => amlRiskApi.resolveCondition(c.id, "waived").then(refreshCase)}
                          >
                            <XCircle aria-hidden="true" className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assessment history</CardTitle>
          <CardDescription>Immutable log of every re-scoring.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table aria-label="Assessment history">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">When</TableHead>
                  <TableHead scope="col">Rating</TableHead>
                  <TableHead scope="col">ML/TF</TableHead>
                  <TableHead scope="col">Completion</TableHead>
                  <TableHead scope="col">Verification</TableHead>
                  <TableHead scope="col">Holds</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.length === 0 && (
                  <AmlTableEmptyRow colSpan={6}>
                    No assessments recorded yet. Run an assessment above to start the log.
                  </AmlTableEmptyRow>
                )}
                {history.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs">{new Date(a.created_at).toLocaleString('en-AU')}</TableCell>
                    <TableCell><Badge className={RATING_TONE[a.risk_rating ?? "low"] ?? ""}>{(a.risk_rating ?? "?").toUpperCase()}</Badge></TableCell>
                    <TableCell>{Math.round(a.mltf_score)}</TableCell>
                    <TableCell>{Math.round(a.completion_score)}</TableCell>
                    <TableCell>{Math.round(a.verification_score)}</TableCell>
                    <TableCell className="text-xs">{a.triggered_holds.map((h) => h.key).join(", ") || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{Math.round(value)}</span>
      </div>
      <Progress value={Math.min(100, Math.max(0, value))} />
    </div>
  );
}
