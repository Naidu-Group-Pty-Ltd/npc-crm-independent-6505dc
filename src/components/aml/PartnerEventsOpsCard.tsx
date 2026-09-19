import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Waypoints } from "lucide-react";
import { amlRelianceApi, type PartnerEventsHealth } from "@/lib/aml/amlRelianceApi";

/**
 * Partner compliance events — narrow Phase 6 operational visibility.
 *
 * Every figure is read live from the database when the card loads, and each
 * count expands into the underlying filtered rows so operations can see the
 * records behind the number, not just the number.
 *
 * What this card never claims: any worker deployment, scheduling or run
 * state. "Recording enabled/disabled" restates the stored feature flag —
 * recorded configuration — and a growing pending count with no consumer is
 * shown as exactly that: a backlog.
 */
export function PartnerEventsOpsCard() {
  const [health, setHealth] = useState<PartnerEventsHealth | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { health: h } = await amlRelianceApi.getPartnerEventsHealth();
      setHealth(h ?? null);
      setUnavailable(!h);
    } catch {
      // Function or Phase 6 migration not present in this environment —
      // say so instead of guessing.
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const ageOf = (iso: string | null) => {
    if (!iso) return null;
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `${mins}m`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
    return `${Math.round(mins / (60 * 24))}d`;
  };

  return (
    <Card data-testid="partner-events-ops-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Waypoints className="h-4 w-4 text-primary" />
          Partner compliance events
          <span className="ml-auto flex items-center gap-2">
            {health && (
              <Badge variant="outline" className={health.outbox_enabled ? "text-success" : "text-muted-foreground"}>
                {health.outbox_enabled ? "recording enabled" : "recording disabled"}
              </Badge>
            )}
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </span>
        </CardTitle>
        <CardDescription>
          Outbox backlog, refresh obligations and arrangement reviews for the
          partner/reliance domain. Flag state is recorded configuration — this
          card makes no claim about worker deployment or scheduling. Full
          queues, registers and readiness:{" "}
          <a href="/admin/aml/partner-operations" className="underline underline-offset-2">
            Partner Operations
          </a>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {unavailable && (
          <p className="text-sm text-muted-foreground">
            Partner event telemetry is not available in this environment
            (the Phase 6 migration or function operation is not present).
            Status: unknown — not verified.
          </p>
        )}
        {!unavailable && !health && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {health && (
          <>
            {!health.outbox_enabled && (
              <p className="text-xs text-muted-foreground">
                aml_partner_event_outbox is off: no events are being recorded
                and material-change invalidation is unavailable. Figures below
                reflect any previously recorded data only.
              </p>
            )}
            {health.outbox_enabled && health.pending_count > 0 && (
              <p className="text-xs text-warning">
                {health.pending_count} event{health.pending_count === 1 ? "" : "s"} awaiting a consumer.
                If this number only grows, the outbox worker is not being invoked — operator action required.
              </p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Pending events" value={health.pending_count}
                sub={health.oldest_pending_at ? `oldest ${ageOf(health.oldest_pending_at)}` : undefined}
                tone={health.pending_count > 0 ? "warn" : undefined} />
              <Stat label="Retrying" value={health.retrying_count}
                tone={health.retrying_count > 0 ? "warn" : undefined} />
              <Stat label="Failed (dead letter)" value={health.dead_letter_count}
                tone={health.dead_letter_count > 0 ? "bad" : undefined} />
              <Stat label="Open refresh obligations" value={health.open_obligation_count}
                sub={health.overdue_obligation_count > 0 ? `${health.overdue_obligation_count} overdue` : undefined}
                tone={health.overdue_obligation_count > 0 ? "warn" : undefined} />
              <Stat label="Attestations flagged for refresh" value={health.refresh_required_attestation_count}
                tone={health.refresh_required_attestation_count > 0 ? "warn" : undefined} />
              <Stat label="Arrangement reviews due ≤30d" value={health.arrangement_reviews_due_count}
                tone={health.arrangement_reviews_due_count > 0 ? "warn" : undefined} />
            </div>

            <RecordList
              label="Pending events" testId="pending-events"
              rows={health.pending_events.map((e) => (
                `${e.event_type} · ${new Date(e.occurred_at).toLocaleString('en-AU')} · attempts ${e.attempts}${e.last_error ? ` · ${e.last_error.slice(0, 80)}` : ""}`
              ))} />
            <RecordList
              label="Dead letters" testId="dead-letters"
              rows={health.dead_letters.map((d) => (
                `${d.event_type} · failed ${new Date(d.failed_at).toLocaleString('en-AU')} · attempts ${d.attempts}`
              ))} />
            <RecordList
              label="Open refresh obligations" testId="open-obligations"
              rows={health.open_obligations.map((o) => (
                `${o.required_action.replace(/_/g, " ")} · ${o.safe_reason_code.replace(/_/g, " ")} · case ${o.case_id.slice(0, 8)}…${o.due_at ? ` · due ${new Date(o.due_at).toLocaleDateString('en-AU')}` : ""}`
              ))} />
            <RecordList
              label="Attestations flagged for refresh" testId="flagged-attestations"
              rows={health.refresh_required_attestations.map((a) => (
                `v${a.version} · case ${a.case_id.slice(0, 8)}… · flagged ${new Date(a.refresh_required_at).toLocaleString('en-AU')}`
              ))} />
            <RecordList
              label="Arrangement reviews due" testId="arrangement-reviews"
              rows={health.arrangement_reviews_due.map((a) => (
                `${a.partner_org_name} · review due ${a.next_review_due}`
              ))} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub, tone }: {
  label: string; value: number; sub?: string; tone?: "warn" | "bad";
}) {
  const toneClass = tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Each metric expands into the filtered records behind it, so the number is
 * never the end of the trail. */
function RecordList({ label, rows, testId }: { label: string; rows: string[]; testId: string }) {
  if (rows.length === 0) return null;
  return (
    <details data-testid={`partner-events-${testId}`} className="text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        {label} — {rows.length} record{rows.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-1 space-y-0.5 pl-4 list-disc text-muted-foreground">
        {rows.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
    </details>
  );
}
