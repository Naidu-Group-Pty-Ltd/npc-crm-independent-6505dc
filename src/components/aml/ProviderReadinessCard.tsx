/**
 * Read-only IDV/screening provider readiness — the operator preflight for
 * identity verification. Reports recorded configuration and runtime booleans
 * from the server's provider_readiness op; it never claims a provider call
 * has been made and never shows a secret value.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { amlVerificationApi, type ProviderReadiness, type CapabilityReadiness } from "@/lib/aml/amlVerificationApi";

const STATE_PRESENTATION: Record<string, { label: string; tone: "default" | "secondary" | "destructive" | "outline" }> = {
  ready_live: { label: "Ready (live)", tone: "default" },
  simulator_non_production: { label: "Simulator — non-production test mode", tone: "secondary" },
  not_configured: { label: "Not configured", tone: "destructive" },
  misconfigured: { label: "Misconfigured", tone: "destructive" },
  unavailable: { label: "Unavailable", tone: "destructive" },
  unknown: { label: "Unknown", tone: "outline" },
};

function CapabilityRow({ r }: { r: CapabilityReadiness }) {
  const p = STATE_PRESENTATION[r.state] ?? STATE_PRESENTATION.unknown;
  const secrets = Object.entries(r.secrets_present ?? {});
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-2 text-sm">
      <div className="min-w-0">
        <div className="font-medium">{r.capability === "idv" ? "Identity verification" : "Screening"}</div>
        <div className="text-xs text-muted-foreground">
          Provider: {r.configured_provider ?? "none configured"} · mode {r.mode}
          {secrets.length > 0 && (
            <> · secrets {secrets.map(([k, v]) => `${k.replace("AML_VERIFICATION_SERVICE_", "").toLowerCase()} ${v ? "present" : "missing"}`).join(", ")}</>
          )}
          {r.last_health?.status && <> · last health {r.last_health.status}</>}
        </div>
      </div>
      <Badge variant={p.tone}>{p.label}</Badge>
    </div>
  );
}

export function ProviderReadinessCard() {
  const [readiness, setReadiness] = useState<ProviderReadiness | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    amlVerificationApi.providerReadiness()
      .then(setReadiness)
      .catch(() => setFailed(true));
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Verification provider readiness</CardTitle>
        <CardDescription>
          {readiness
            ? `Environment: ${readiness.environment}${readiness.simulator_blocked ? " — simulator blocked" : ""}. ${readiness.note}`
            : failed
              ? "Readiness could not be read — the verification function did not answer."
              : "Loading…"}
        </CardDescription>
      </CardHeader>
      {readiness && (
        <CardContent className="pt-0">
          <CapabilityRow r={readiness.idv} />
          <CapabilityRow r={readiness.screening} />
        </CardContent>
      )}
    </Card>
  );
}
