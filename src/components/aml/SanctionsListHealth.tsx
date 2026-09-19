import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Database, RefreshCw, Upload, XCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { amlVerificationApi, type AmlSanctionsSync } from "@/lib/aml/amlVerificationApi";
import { toast } from "@/hooks/use-toast";

/**
 * Sanctions list freshness.
 *
 * Screening against an empty or stale list returns "clear" for everybody, and
 * looks exactly like screening that worked. That failure is silent everywhere
 * else in the product, so it is surfaced here rather than left to a script an
 * operator has to remember to run.
 */

/** A list older than this is not a current list. Mirrors scripts/aml/kyc-preflight.mjs. */
const STALE_DAYS = 7;

const LISTS: Array<{ code: string; label: string; note: string }> = [
  { code: "dfat", label: "DFAT Consolidated List", note: "Australia — legally operative" },
  { code: "un", label: "UN Consolidated List", note: "United Nations Security Council" },
  { code: "ofac", label: "OFAC SDN", note: "United States Treasury" },
];

type Health = "current" | "stale" | "failed" | "never";

function healthOf(sync: AmlSanctionsSync | undefined): { state: Health; ageDays: number | null } {
  if (!sync) return { state: "never", ageDays: null };
  if (sync.status === "failed") return { state: "failed", ageDays: null };
  const stamp = sync.completed_at ?? sync.started_at;
  const ageDays = (Date.now() - new Date(stamp).getTime()) / 86_400_000;
  return { state: ageDays > STALE_DAYS ? "stale" : "current", ageDays };
}

const PRESENTATION: Record<Health, { tone: string; label: string; Icon: typeof CheckCircle2 }> = {
  current: { tone: "bg-success/15 text-success", label: "Current", Icon: CheckCircle2 },
  stale: { tone: "bg-warning/15 text-warning", label: "Stale", Icon: AlertTriangle },
  failed: { tone: "bg-destructive/15 text-destructive", label: "Last sync failed", Icon: XCircle },
  never: { tone: "bg-destructive/15 text-destructive", label: "Never loaded", Icon: XCircle },
};

/**
 * Load the register from a spreadsheet a person downloaded.
 *
 * The batch loader (`npm run aml:sanctions:load`) needs the production
 * service-role key on somebody's laptop AND a successful download from
 * dfat.gov.au — which answers HTTP 403 to a scripted request. That is why
 * this table has been empty since the platform was built, and why every
 * screening attempt fails closed.
 *
 * A person with a browser is blocked by neither. So: they download the
 * Consolidated List themselves, drop it here, and the browser does exactly
 * one job — get the cells out of the container. Mapping and normalisation
 * happen on the server, because names must be indexed with the same function
 * the screening query uses.
 */
function LoadListControl({ onLoaded }: { onLoaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      // `header: 1` keeps raw rows. Anything cleverer here would be mapping,
      // and mapping belongs on the server.
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false });
      if (!rows || rows.length === 0) {
        toast({
          title: "Nothing to load",
          description: "That file's first sheet is empty.",
          variant: "destructive",
        });
        return;
      }
      const res = await amlVerificationApi.ingestSanctionsList(rows, file.name);
      /*
       * Say what the load did to SCREENING, not only to the register.
       *
       * "Screening can now match against this list" was the old wording and it
       * was not true on its own: production refuses to run the provider while
       * it sits in simulator mode, so a full load still completed no checks.
       * The server reports what it did about that, and it is the sentence the
       * operator actually needs.
       */
      const pruning = res.pruned_skipped
        ? res.reason
        : `${res.pruned.toLocaleString('en-AU')} superseded entries removed.`;
      /*
       * State how current the DATA is, not just how many rows arrived. An
       * operator reading "7,840 entries" cannot tell the operative register
       * from an archived one, and the file DFAT's own canonical URL currently
       * redirects to is four years out of date.
       */
      const currency = res.recency_unknown
        ? "The file carries no listing dates, so its currency could not be established."
        : res.newest_listing
          ? `Newest listing in this file: ${res.newest_listing}.`
          : "";
      toast({
        title: res.screening?.changed
          ? `Loaded ${res.entries.toLocaleString('en-AU')} entries — screening is now live`
          : `Loaded ${res.entries.toLocaleString('en-AU')} entries`,
        description: [pruning, currency, res.screening?.reason].filter(Boolean).join(" "),
      });
      onLoaded();
    } catch (e: unknown) {
      toast({
        title: "The list could not be loaded",
        description: e instanceof Error ? e.message : "The spreadsheet could not be read.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="sr-only"
        id="sanctions-list-file"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
      />
      <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy
          ? <RefreshCw aria-hidden className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" />
          : <Upload aria-hidden className="mr-1.5 h-4 w-4" />}
        {busy ? "Loading…" : "Load DFAT list"}
      </Button>
      <span className="text-xs text-muted-foreground">
        Download the Consolidated List from dfat.gov.au and drop the spreadsheet here.
      </span>
    </div>
  );
}

export function SanctionsListHealth() {
  const [syncs, setSyncs] = useState<AmlSanctionsSync[] | null>(null);
  const [entryCount, setEntryCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await amlVerificationApi.sanctionsListStatus();
      setSyncs(res.syncs);
      setEntryCount(res.entry_count);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unable to load sanctions list status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Most recent successful sync per list.
  const latestFor = (code: string) =>
    (syncs ?? [])
      .filter((s) => s.list_code === code && s.status === "succeeded")
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0]
    ?? (syncs ?? []).filter((s) => s.list_code === code)
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" aria-hidden="true" />
            Sanctions list health
          </CardTitle>
          <CardDescription>
            Screening runs against our own copy of the official lists. An empty or stale
            list returns &ldquo;clear&rdquo; for every party and looks identical to a
            screen that worked.
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={load}
          disabled={loading}
          aria-label="Refresh sanctions list status"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading && !syncs && <Skeleton className="h-32 w-full" />}

        {!loading && entryCount === 0 && !error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="space-y-2">
              <p>
                No sanctions entries are loaded. Screening cannot match anyone and every
                check fails closed until the DFAT Consolidated List is loaded.
              </p>
              <LoadListControl onLoaded={load} />
            </AlertDescription>
          </Alert>
        )}

        {syncs && (
          <>
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{entryCount.toLocaleString('en-AU')}</span> entries held across all lists
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>List</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Last loaded</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {LISTS.map(({ code, label, note }) => {
                  const sync = latestFor(code);
                  const { state, ageDays } = healthOf(sync);
                  const { tone, label: stateLabel, Icon } = PRESENTATION[state];
                  return (
                    <TableRow key={code}>
                      <TableCell>
                        <div className="font-medium">{label}</div>
                        <div className="text-xs text-muted-foreground">{note}</div>
                      </TableCell>
                      <TableCell>{sync?.status === "succeeded" ? sync.entry_count.toLocaleString('en-AU') : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {sync
                          ? `${new Date(sync.completed_at ?? sync.started_at).toLocaleDateString('en-AU')}${
                              ageDays != null ? ` (${Math.floor(ageDays)}d ago)` : ""}`
                          : "Never"}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${tone}`}>
                          <Icon className="h-3 w-3" aria-hidden="true" /> {stateLabel}
                        </span>
                        {state === "failed" && sync?.error_detail && (
                          <div className="text-xs text-muted-foreground mt-1 max-w-xs truncate" title={sync.error_detail}>
                            {sync.error_detail}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <LoadListControl onLoaded={load} />

            <p className="text-xs text-muted-foreground">
              Lists refresh nightly via the <code className="font-mono">AML sanctions refresh</code> workflow.
              Anything older than {STALE_DAYS} days is flagged stale.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
