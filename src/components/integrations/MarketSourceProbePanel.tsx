/**
 * ME-5.1 — the operator surface for `market-source-probe`.
 *
 * The probe has existed since §51 and had **never been run**. Not because it
 * was broken: it requires an authenticated administrator session, and no
 * surface in the product invoked it, so the only ways to reach it were a
 * browser console or a service-role key on the wire. A diagnostic nobody can
 * run is a diagnostic that does not exist.
 *
 * This is one button on the page where market-data credentials are set, using
 * the session the operator already has. Two properties matter:
 *
 * **It reads; it never writes.** The probe writes no table, no report and no
 * score, and this panel adds nothing to that.
 *
 * **A credential is presence only.** The probe returns booleans, this panel
 * renders booleans, and there is no value, length or prefix anywhere in the
 * path — a length is a hint and a prefix identifies the issuer.
 *
 * The verdict vocabulary and its owners come from
 * `sourceProbeReading.pure.ts`, which the probe's own classification mirrors,
 * so what an operator is shown and what the server decided cannot drift.
 */
import { useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, MinusCircle, Radar, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  describeAuthAttempt,
  describeVerdict,
  interpretDomainAccess,
  groupCredentialPresence,
  summariseProbe,
  PROVIDER_STATUS_READING,
  type ReadingTone,
} from '@/lib/reports/market/sourceProbeReading.pure';

interface ProbeResult {
  id: string;
  note?: string;
  status: number;
  verdict: string;
  elapsedMs?: number;
  error?: string;
  kind?: 'commercial' | 'government';
  credentialSent?: boolean;
  authNotImplemented?: boolean;
  contentType?: string | null;
  bodyPreview?: string;
  providerHeaders?: Record<string, string>;
  securityReason?: string | null;
}

interface ProbeResponse {
  probe?: string;
  probedAt?: string;
  credentialsPresent?: Record<string, boolean>;
  providers?: Record<string, { status?: string; authScheme?: string; repositoryImplementation?: string; licensingStatus?: string }>;
  results?: ProbeResult[];
}

/** Tone → semantic token classes. No raw palette anywhere. */
const TONE_CLASS: Record<ReadingTone, string> = {
  positive: 'border-success/35 bg-success/10 text-success',
  neutral: 'border-border bg-muted/40 text-muted-foreground',
  attention: 'border-warning/35 bg-warning/10 text-warning',
  blocked: 'border-destructive/35 bg-destructive/10 text-destructive',
};

const AU_DATETIME = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export default function MarketSourceProbePanel() {
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<ProbeResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setFailure(null);
    try {
      const { data, error } = await invokeSecureFunction<ProbeResponse>('market-source-probe', {});
      if (error) {
        // The reason is the finding: an authentication refusal and an
        // unreachable function send an operator to opposite remedies.
        setFailure(error.message || 'The probe could not be reached.');
        setResponse(null);
        return;
      }
      setResponse(data ?? null);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
      setResponse(null);
    } finally {
      setRunning(false);
    }
  };

  const summary = response?.credentialsPresent ? summariseProbe(response.credentialsPresent) : null;
  const groups = response?.credentialsPresent ? groupCredentialPresence(response.credentialsPresent) : [];

  return (
    <section className="glass-raised min-w-0 rounded-2xl p-5 sm:p-6" aria-labelledby="market-source-probe-heading">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-[16rem] flex-1 space-y-1">
          <h2
            id="market-source-probe-heading"
            className="flex items-center gap-2 text-base font-semibold text-foreground"
          >
            <Radar className="h-4 w-4 text-primary" aria-hidden="true" />
            Market source probe
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Read-only. Reports which market-data credential <strong className="font-semibold text-foreground">names</strong> are
            set in this deployment&rsquo;s runtime — never a value — and asks a fixed list of provider and government
            sources what they answer from here. It writes nothing.
          </p>
        </div>
        <Button
          onClick={run}
          disabled={running}
          aria-busy={running}
          className="min-h-[44px] shrink-0 gap-2 rounded-xl px-4 font-semibold"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Radar className="h-4 w-4" aria-hidden="true" />}
          {running ? 'Probing…' : 'Run source probe'}
        </Button>
      </div>

      {failure && (
        <Alert className="mt-4 rounded-xl border-destructive/35 bg-destructive/10">
          <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden="true" />
          <AlertDescription className="text-sm text-foreground">
            <span className="font-semibold">The probe did not answer.</span> {failure}
          </AlertDescription>
        </Alert>
      )}

      {response && (
        <div className="mt-5 space-y-6">
          {summary && (
            <div className="space-y-2">
              <p className="text-sm leading-6 text-foreground">{summary.reading}</p>
              {response.probedAt && (
                <p className="text-xs text-muted-foreground">
                  Probed {AU_DATETIME.format(new Date(response.probedAt))}
                </p>
              )}
            </div>
          )}

          {groups.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Credential names — presence only</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {groups.map((group) => (
                  <li key={group.provider} className="glass-subtle rounded-xl p-3">
                    <p className="text-sm font-medium text-foreground">{group.label}</p>
                    <ul className="mt-2 space-y-1">
                      {group.names.map((entry) => (
                        <li key={entry.name} className="flex items-center gap-2 text-xs">
                          {entry.set ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                          ) : (
                            <MinusCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          )}
                          <code className="min-w-0 truncate font-mono text-muted-foreground">{entry.name}</code>
                          <span className="ml-auto shrink-0 text-muted-foreground">{entry.set ? 'set' : 'not set'}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {response.providers && Object.keys(response.providers).length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">How each provider stands before any call</h3>
              <ul className="space-y-2">
                {Object.entries(response.providers).map(([name, provider]) => {
                  const reading = provider?.status ? PROVIDER_STATUS_READING[provider.status] : undefined;
                  return (
                    <li key={name} className="glass-subtle rounded-xl p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium capitalize text-foreground">{name}</span>
                        <Badge variant="outline" className={TONE_CLASS[reading?.tone ?? 'neutral']}>
                          {reading?.label ?? provider?.status ?? 'not reported'}
                        </Badge>
                        {reading && (
                          <span className="text-xs text-muted-foreground">owner: {reading.owner}</span>
                        )}
                      </div>
                      {reading && <p className="mt-2 text-xs leading-5 text-muted-foreground">{reading.meaning}</p>}
                      {provider?.repositoryImplementation && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          This repository: {provider.repositoryImplementation}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {response.results?.some((r) => r.id.startsWith('domain_')) && (() => {
            const suggest = response.results!.find((r) => r.id === 'domain_address_suggest');
            const suburb = response.results!.find((r) => r.id === 'domain_v2_suburb_performance');
            const reading = interpretDomainAccess(
              suggest ? { status: suggest.status, securityReason: suggest.securityReason } : null,
              suburb ? { status: suburb.status, securityReason: suburb.securityReason } : null,
            );
            return (
              <div className="glass-subtle rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground">Domain — two products, one key</h3>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{reading.reading}</p>
                <p className="mt-2 flex gap-1.5 text-xs leading-5 text-foreground">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span>{reading.nextStep}</span>
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {reading.conclusive ? 'Conclusive on this evidence.' : 'Not conclusive — nothing is assigned to an owner yet.'}
                  {reading.owner ? ` Owner: ${reading.owner}.` : ''}
                </p>
              </div>
            );
          })()}

          {response.results && response.results.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">What each source answered</h3>
              <ul className="space-y-2">
                {response.results.map((result) => {
                  const reading = describeVerdict(result.verdict);
                  return (
                    <li key={result.id} className="glass-subtle rounded-xl p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="min-w-0 truncate font-mono text-xs text-foreground">{result.id}</code>
                        <Badge variant="outline" className={TONE_CLASS[reading.tone]}>
                          {reading.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          HTTP {result.status || '—'}
                          {typeof result.elapsedMs === 'number' ? ` · ${result.elapsedMs} ms` : ''}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">owner: {reading.owner}</span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">{reading.meaning}</p>
                      {result.securityReason && (
                        <p className="mt-2 rounded-lg border border-warning/35 bg-warning/10 px-2 py-1.5 text-xs leading-5 text-foreground">
                          <span className="font-semibold">Domain’s stated reason:</span>{' '}
                          <code className="font-mono">{result.securityReason}</code>
                        </p>
                      )}
                      <p className="mt-1 text-xs italic leading-5 text-muted-foreground">
                        {describeAuthAttempt(
                          result.credentialSent === true,
                          result.authNotImplemented === true,
                          result.kind,
                        ).line}
                      </p>
                      {reading.nextAction && (
                        <p className="mt-1 flex gap-1.5 text-xs leading-5 text-foreground">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                          <span>{reading.nextAction}</span>
                        </p>
                      )}
                      {(result.bodyPreview || result.providerHeaders) && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                            What the source itself said
                          </summary>
                          <div className="mt-2 space-y-1">
                            {result.contentType && (
                              <p className="text-xs text-muted-foreground">
                                content-type: <code className="font-mono">{result.contentType}</code>
                              </p>
                            )}
                            {result.providerHeaders && Object.keys(result.providerHeaders).length > 0 && (
                              <ul className="space-y-0.5">
                                {Object.entries(result.providerHeaders).map(([h, v]) => (
                                  <li key={h} className="text-xs text-muted-foreground">
                                    <code className="font-mono">{h}</code>: {v}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {result.bodyPreview && (
                              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/40 p-2 text-[11px] leading-4 text-muted-foreground">
                                {result.bodyPreview}
                              </pre>
                            )}
                          </div>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
