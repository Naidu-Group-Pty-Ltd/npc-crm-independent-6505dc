import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClipboardList, Gauge, ListChecks, BarChart3 } from "lucide-react";
import { AmlErrorState, AmlPageHeader, AmlRefreshButton } from "@/components/aml/primitives";
import {
  amlRelianceApi,
  type PartnerManagementReport,
  type PartnerQueueEntry,
  type PartnerReadiness,
} from "@/lib/aml/amlRelianceApi";

/**
 * Partner compliance operations (Phase 8): queues, filtered registers,
 * management reporting and the readiness/preflight panel for the
 * partner/reliance domain.
 *
 * Honesty rules this page keeps:
 *  - every queue count deep-links (via URL params) into the register below,
 *    filtered identically — the number always reproduces its record set;
 *  - queues a role may not see are simply absent (the server omits them);
 *  - the readiness panel reports database-verifiable facts and recorded
 *    configuration only. Where evidence cannot be obtained it says
 *    "Unknown — not verified", never a deployment claim.
 */
export default function AmlPartnerOperations() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [queues, setQueues] = useState<PartnerQueueEntry[] | null>(null);
  const [slaNote, setSlaNote] = useState<string>("");
  const [disabled, setDisabled] = useState(false);
  const [registerRows, setRegisterRows] = useState<Record<string, unknown>[]>([]);
  const [registerDenied, setRegisterDenied] = useState<string | null>(null);
  const [report, setReport] = useState<PartnerManagementReport | null>(null);
  const [readiness, setReadiness] = useState<PartnerReadiness | null>(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const register = searchParams.get("register") ?? "";
  const registerStatus = searchParams.get("status") ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dash = await amlRelianceApi.getPartnerOperationsDashboard();
      setQueues(dash.queues ?? []);
      setSlaNote(dash.sla_note ?? "");
      setDisabled(false);
    } catch (e: any) {
      setQueues(null);
      setDisabled(true);
    }
    try {
      const { readiness: r } = await amlRelianceApi.getPartnerReadiness();
      setReadiness(r ?? null);
    } catch {
      setReadiness(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!register) { setRegisterRows([]); setRegisterDenied(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await amlRelianceApi.listPartnerRegister({
          register, status: registerStatus || undefined,
        });
        if (!cancelled) { setRegisterRows(res.rows ?? []); setRegisterDenied(null); }
      } catch (e: any) {
        if (!cancelled) {
          setRegisterRows([]);
          setRegisterDenied(e?.message ?? "Register unavailable");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [register, registerStatus]);

  const loadReport = useCallback(async () => {
    try {
      const { report: r } = await amlRelianceApi.getPartnerManagementReport({
        from: from || undefined, to: to || undefined,
      });
      setReport(r ?? null);
    } catch {
      setReport(null);
    }
  }, [from, to]);

  const openRegister = (q: PartnerQueueEntry) => {
    const next = new URLSearchParams(searchParams);
    next.set("register", q.register);
    if (q.registerStatus) next.set("status", q.registerStatus);
    else next.delete("status");
    setSearchParams(next);
  };

  const ageTone = (age: PartnerQueueEntry["age"]) =>
    age === "escalate" ? "text-destructive" : age === "warn" ? "text-warning" : "text-muted-foreground";

  return (
    <div className="space-y-6" data-testid="aml-partner-operations">
      {/* AmlRefreshButton renders its label as the accessible name, i.e.
          aria-label="Refresh partner operations" in the DOM (§8.9). */}
      <AmlPageHeader
        icon={Gauge}
        title="Partner compliance operations"
        description="Queues, registers, reporting and readiness for the partner/reliance domain. Ageing thresholds are operational targets, never statutory deadlines."
        actions={
          <AmlRefreshButton onClick={load} loading={loading} label="Refresh partner operations" />
        }
      />

      {disabled && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Partner operations reporting is not enabled in this environment.
            The readiness panel below still reports what the database can
            evidence.
          </CardContent>
        </Card>
      )}

      {queues && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" aria-hidden="true" />
              Compliance queues
            </CardTitle>
            <CardDescription>{slaNote}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Partner compliance queues">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Queue</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Count</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Oldest</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Responsible</th>
                  <th scope="col" className="py-1.5 font-medium"><span className="sr-only">Open filtered register</span></th>
                </tr>
              </thead>
              <tbody>
                {queues.map((q) => (
                  <tr key={q.key} className="border-t border-border">
                    <td className="py-1.5 pr-3">{q.label}</td>
                    <td className={`py-1.5 pr-3 tabular-nums font-semibold ${q.count > 0 ? ageTone(q.age) : "text-muted-foreground"}`}>
                      {q.count}
                    </td>
                    <td className={`py-1.5 pr-3 text-xs ${ageTone(q.age)}`}>
                      {q.oldestAt ? new Date(q.oldestAt).toLocaleDateString('en-AU') : "—"}
                      {q.age !== "ok" && <span className="ml-1 uppercase">{q.age}</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">
                      {q.ownerRole === "partner_organisation" ? "Partner organisation" : q.ownerRole.toUpperCase()}
                    </td>
                    <td className="py-1.5 text-right">
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                        onClick={() => openRegister(q)}
                        aria-label={`Open the filtered register behind "${q.label}"`}>
                        Open records
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {register && (
        <Card data-testid="partner-register">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" aria-hidden="true" />
              Register: {register.replace(/_/g, " ")}
              {registerStatus && (
                <Badge variant="outline">{registerStatus.replace(/_/g, " ")}</Badge>
              )}
            </CardTitle>
            <CardDescription>
              The same filter the queue count was computed from — this list is
              that number's record set.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {registerDenied ? (
              <AmlErrorState title="Register unavailable" message={registerDenied} />
            ) : registerRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No records match this filter.</p>
            ) : (
              <table className="w-full text-xs" aria-label={`Register ${register}`}>
                <thead>
                  <tr className="text-left text-muted-foreground">
                    {Object.keys(registerRows[0]).map((col) => (
                      <th scope="col" key={col} className="py-1 pr-3 font-medium">{col.replace(/_/g, " ")}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {registerRows.map((row, i) => (
                    <tr key={i} className="border-t border-border align-top">
                      {Object.values(row).map((v, j) => (
                        <td key={j} className="py-1 pr-3 max-w-[220px] truncate">
                          {v === null || v === undefined ? "—"
                            : typeof v === "object" ? JSON.stringify(v)
                            : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {!disabled && (
        <Card data-testid="partner-management-report">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />
              Management report
            </CardTitle>
            <CardDescription>
              Tenant-scoped measures over the partner domain. Choose an
              optional date range and generate.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-muted-foreground">
                From
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                  className="mt-1 h-8 w-[150px]" aria-label="Report from date" />
              </label>
              <label className="text-xs text-muted-foreground">
                To
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                  className="mt-1 h-8 w-[150px]" aria-label="Report to date" />
              </label>
              <Button size="sm" variant="outline" onClick={loadReport}>Generate</Button>
            </div>
            {report && (
              <div className="grid gap-4 md:grid-cols-3 text-sm" data-testid="report-sections">
                <ReportSection title="Partners" entries={{
                  ...Object.fromEntries(Object.entries(report.partners.links_by_legal_route)
                    .map(([k, v]) => [`links — ${k.replace(/_/g, " ")}`, v])),
                  "grants active": report.partners.grants_active,
                  "grants revoked": report.partners.grants_revoked,
                  "grants expired": report.partners.grants_expired,
                  "access events": report.partners.access_events,
                  "evidence deliveries": report.partners.evidence_deliveries,
                  "refresh required (open)": report.partners.refresh_required_open,
                  ...Object.fromEntries(Object.entries(report.partners.determinations_by_outcome)
                    .map(([k, v]) => [`determinations — ${k.replace(/_/g, " ")}`, v])),
                }} />
                <ReportSection title="Arrangements" entries={{
                  "overdue reviews": report.arrangements.overdue_reviews,
                  ...Object.fromEntries(Object.entries(report.arrangements.eligibility_states)
                    .map(([k, v]) => [k.replace(/_/g, " "), v])),
                }} />
                <ReportSection title="Records" entries={{
                  "operative triggers": report.records.operative_triggers,
                  "active legal holds": report.records.active_legal_holds,
                  "retention due": report.records.retention_due_items,
                  "blocked disposals": report.records.blocked_disposals,
                  "scan approvals": report.records.scan_approvals,
                  "disposal failures": report.records.disposal_failures,
                  "evidence receipts": report.records.disposal_evidence_receipts,
                }} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card data-testid="partner-readiness-panel">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Readiness &amp; preflight</CardTitle>
          <CardDescription>
            {readiness?.notice ??
              "Database-verifiable facts and recorded configuration only. Nothing here asserts deployment, scheduling or production state."}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!readiness ? (
            <p className="text-sm text-muted-foreground">
              Readiness could not be read in this environment. Status: unknown —
              not verified.
            </p>
          ) : (
            <table className="w-full text-sm" aria-label="Partner domain readiness">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Check</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">State</th>
                  <th scope="col" className="py-1.5 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {readiness.items.map((item) => (
                  <tr key={item.key} className="border-t border-border align-top">
                    <td className="py-1.5 pr-3">{item.label}</td>
                    <td className="py-1.5 pr-3">
                      <Badge variant="outline" className={
                        item.state === "action_required" ? "text-destructive"
                          : item.state === "attention" || item.state === "missing" ? "text-warning"
                          : item.state === "unknown" || item.state === "disabled" ? "text-muted-foreground"
                          : "text-success"
                      }>
                        {item.state.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="py-1.5 text-xs text-muted-foreground">{item.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReportSection({ title, entries }: { title: string; entries: Record<string, number> }) {
  return (
    <div className="rounded-md border border-border p-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">{title}</h3>
      <dl className="space-y-1">
        {Object.entries(entries).map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="tabular-nums font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
