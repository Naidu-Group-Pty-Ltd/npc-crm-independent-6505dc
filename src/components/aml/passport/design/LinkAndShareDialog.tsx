/**
 * Link & Share — the guided distribution workflow (§7).
 *
 * Seven steps, in the order a compliance operator actually reasons: confirm
 * WHAT is being shared, WHO with, on WHAT relationship, under WHICH legal
 * route, containing WHAT evidence, then confirm, then read the per-partner
 * result.
 *
 * The dialog gathers a decision and hands it to one canonical server
 * operation. It computes nothing: the route shown at step 4 is the route the
 * server read off the partner link, the evidence at step 5 is the server's
 * classification, and "eligible" at step 2 is `readiness.ready`. If the server
 * changes its mind between opening this dialog and confirming — a revocation,
 * a superseding version, an expiring arrangement — the write path re-checks
 * and the outcome at step 7 says so. This dialog is never the authority.
 *
 * Step 4 is the one that matters most legally. When section 37A reliance is
 * unavailable the dialog says exactly what is missing and offers the route the
 * partner CAN take. It never quietly swaps one legal basis for another.
 */
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { amlRelianceApi, type PassportDistributionReadinessResponse, type PassportShareResponse } from "@/lib/aml/amlRelianceApi";
import {
  canShare,
  evidenceCellState,
  isBulkEligible,
  isRelianceRoute,
  outcomeLabel,
  outcomeTone,
  portalLabel,
  routeExplanation,
  routeLabel,
  stateLabel,
  stateTone,
  BLOCKER_TITLE,
  EVIDENCE_CATEGORY_LABEL,
  EVIDENCE_CLASS_ORDER,
  MATRIX_CELL_LABEL,
  type ReadinessView,
} from "@/lib/aml/passport/distributionPresentation.pure";
import { formatPassportDate } from "../format";
import { SectionTitle, TonePill } from "./primitives";

const STEPS = [
  "Passport",
  "Partners",
  "Relationship",
  "Legal route",
  "Evidence",
  "Confirm",
  "Result",
] as const;

export function LinkAndShareDialog({
  caseId,
  readiness,
  preselected,
  onClose,
  onCompleted,
}: {
  caseId: string;
  readiness: PassportDistributionReadinessResponse;
  preselected: string[];
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>(
    preselected.filter(Boolean),
  );
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PassportShareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const partners = readiness.partners;
  const chosen = useMemo(
    () => partners.filter((p) => p.partner.org_id && selected.includes(p.partner.org_id)),
    [partners, selected],
  );
  // "Eligible" is the server's word. A partner the server did not mark ready
  // cannot be selected into a share from here.
  const eligible = useMemo(() => partners.filter(isBulkEligible), [partners]);

  const canAdvance =
    step === 1 ? chosen.length > 0 && chosen.every(canShare) : true;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const ids = chosen.map((p) => p.partner.org_id!).filter(Boolean);
      const res = ids.length === 1
        ? await amlRelianceApi.sharePassportToPartner(caseId, ids[0])
        : await amlRelianceApi.sharePassportToPartners(caseId, ids);
      setResult(res);
      setStep(6);
      onCompleted();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "The Passport could not be shared just now.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="passport-scope max-h-[86vh] max-w-2xl overflow-y-auto p-0">
        <DialogTitle className="sr-only">Link and share the Compliance Passport</DialogTitle>

        <div className="p-6">
          <ol className="mb-5 flex flex-wrap gap-x-3 gap-y-1.5" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5">
                <span
                  className={
                    i === step
                      ? "passport-mono passport-gold-text text-[11px] font-semibold"
                      : "passport-mono passport-faint text-[11px]"
                  }
                  aria-current={i === step ? "step" : undefined}
                >
                  {String(i + 1).padStart(2, "0")} {s}
                </span>
                {i < STEPS.length - 1 && <span aria-hidden="true" className="passport-faint text-[10px]">›</span>}
              </li>
            ))}
          </ol>

          {step === 0 && <StepPassport readiness={readiness} />}
          {step === 1 && (
            <StepPartners
              partners={partners}
              eligible={eligible}
              selected={selected}
              onToggle={(id) =>
                setSelected((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])}
              onSelectAllEligible={() =>
                setSelected(eligible.map((p) => p.partner.org_id!).filter(Boolean))}
            />
          )}
          {step === 2 && <StepRelationship chosen={chosen} />}
          {step === 3 && <StepLegalRoute chosen={chosen} />}
          {step === 4 && <StepEvidence chosen={chosen} />}
          {step === 5 && <StepConfirm chosen={chosen} readiness={readiness} error={error} />}
          {step === 6 && result && <StepResult result={result} chosen={chosen} />}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              className="passport-action w-auto"
              onClick={() => (step === 0 || step === 6 ? onClose() : setStep((s) => s - 1))}
            >
              {step === 0 ? "Cancel" : step === 6 ? "Close" : "Back"}
            </button>

            {step < 5 && (
              <button
                type="button"
                className="passport-action passport-action--primary w-auto"
                disabled={!canAdvance}
                aria-disabled={!canAdvance}
                onClick={() => setStep((s) => s + 1)}
              >
                Continue
              </button>
            )}
            {step === 5 && (
              <button
                type="button"
                className="passport-action passport-action--primary w-auto"
                disabled={submitting || chosen.length === 0}
                aria-disabled={submitting || chosen.length === 0}
                onClick={() => void submit()}
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                {submitting ? "Sharing…" : `Share with ${chosen.length} partner${chosen.length === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── step 1: what is being shared ─────────────────────────────────────── */

function StepPassport({ readiness }: { readiness: PassportDistributionReadinessResponse }) {
  const p = readiness.passport;
  return (
    <div>
      <SectionTitle>Confirm the Passport</SectionTitle>
      <dl className="space-y-0">
        {[
          ["Version", p.version != null ? `v${p.version}` : "Not issued"],
          ["Issued", p.issued_at ? formatPassportDate(p.issued_at) : "—"],
          ["State", String(p.state?.label ?? p.state?.code ?? "—")],
          ["Evidence fingerprint", p.payload_sha256 ? p.payload_sha256.slice(0, 16).toUpperCase() : "—"],
        ].map(([k, v]) => (
          <div key={k} className="passport-rule flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0">
            <dt className="passport-field__k">{k}</dt>
            <dd className="passport-dim text-[13px]">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="passport-faint mt-3 text-[11px] leading-relaxed">
        Every partner review is pinned to this exact version and fingerprint. When a later version
        is issued, the decisions recorded against this one remain as history — they are never
        rewritten.
      </p>
    </div>
  );
}

/* ── step 2: who ──────────────────────────────────────────────────────── */

function StepPartners({
  partners, eligible, selected, onToggle, onSelectAllEligible,
}: {
  partners: ReadinessView[];
  eligible: ReadinessView[];
  selected: string[];
  onToggle: (id: string) => void;
  onSelectAllEligible: () => void;
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>Select partners</SectionTitle>
        {eligible.length > 0 && (
          <button type="button" className="passport-action w-auto" onClick={onSelectAllEligible}>
            Select all eligible ({eligible.length})
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {partners.map((p) => {
          const id = p.partner.org_id ?? "";
          const shareable = canShare(p);
          const checked = selected.includes(id);
          return (
            <li key={id || p.partner.org_name}>
              <label
                className={
                  "passport-card flex cursor-pointer items-start gap-3 p-3" +
                  (shareable ? "" : " opacity-70")
                }
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={checked}
                  disabled={!shareable}
                  onChange={() => id && onToggle(id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="passport-dim block text-[13px] font-semibold">
                    {p.partner.org_name ?? "Unnamed organisation"}
                  </span>
                  <span className="passport-faint block text-[11px]">
                    {portalLabel(p.partner.portal_type)} · {routeLabel(p.legal_route)}
                  </span>
                  {!shareable && (
                    <span className="passport-faint mt-1 block text-[11px]">
                      {p.state === "ALREADY_CURRENT"
                        ? "Already holds the current version — sharing again would change nothing."
                        : p.blockers.map((b) => BLOCKER_TITLE[b]).join(" · ")}
                    </span>
                  )}
                </span>
                <TonePill tone={stateTone(p.state)}>{stateLabel(p.state)}</TonePill>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── step 3: on what relationship ─────────────────────────────────────── */

function StepRelationship({ chosen }: { chosen: ReadinessView[] }) {
  return (
    <div>
      <SectionTitle>Confirm the relationship</SectionTitle>
      <p className="passport-faint mb-3 text-[11px] leading-relaxed">
        Each partner receives the Passport on the existing link between its organisation and this
        matter. No new relationship is created here.
      </p>
      <div className="space-y-2">
        {chosen.map((p) => (
          <div key={p.partner.org_id} className="passport-card p-3">
            <div className="passport-dim text-[13px] font-semibold">{p.partner.org_name}</div>
            <dl className="mt-2 space-y-0">
              {[
                ["Portal", portalLabel(p.partner.portal_type)],
                ["Role", p.partner.relationship_role ?? "Not recorded"],
                ["Purpose", p.partner.purpose ?? "Not recorded"],
              ].map(([k, v]) => (
                <div key={k} className="passport-rule flex items-baseline justify-between gap-3 border-b py-1.5 last:border-b-0">
                  <dt className="passport-field__k">{k}</dt>
                  <dd className="passport-dim text-[12px]">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── step 4: the legal basis ──────────────────────────────────────────── */

function StepLegalRoute({ chosen }: { chosen: ReadinessView[] }) {
  return (
    <div>
      <SectionTitle>Legal route</SectionTitle>
      <p className="passport-faint mb-3 text-[11px] leading-relaxed">
        The route is read from each partner’s link to this matter. Being connected to a portal does
        not by itself create a reliance route, and a route is never changed here to make a
        distribution possible.
      </p>
      <div className="space-y-2">
        {chosen.map((p) => {
          const reliance = isRelianceRoute(p.legal_route);
          const missing = p.blockers.filter((b) =>
            b === "CDD_ARRANGEMENT_REQUIRED" ||
            b === "ARRANGEMENT_ASSESSMENT_REQUIRED" ||
            b === "ARRANGEMENT_REVIEW_OVERDUE" ||
            b === "LEGAL_ROUTE_NOT_RECORDED");
          return (
            <div key={p.partner.org_id} className="passport-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="passport-dim text-[13px] font-semibold">{p.partner.org_name}</span>
                <TonePill tone={reliance ? "ok" : p.legal_route ? "info" : "warn"}>
                  {routeLabel(p.legal_route)}
                </TonePill>
              </div>
              <p className="passport-faint mt-2 text-[11px] leading-relaxed">
                {routeExplanation(p.legal_route)}
              </p>
              {!reliance && (
                <p className="passport-faint mt-2 text-[11px] leading-relaxed">
                  <span className="passport-dim font-semibold">Section 37A reliance is not available.</span>{" "}
                  {missing.length > 0
                    ? `Outstanding: ${missing.map((b) => BLOCKER_TITLE[b]).join(", ")}.`
                    : "This partner’s link records a different legal basis for the matter."}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── step 5: what will be disclosed ───────────────────────────────────── */

function StepEvidence({ chosen }: { chosen: ReadinessView[] }) {
  return (
    <div>
      <SectionTitle>Evidence package</SectionTitle>
      <p className="passport-faint mb-3 text-[11px] leading-relaxed">
        What each partner will be authorised to see. “Not authorised” describes this partner’s
        permission, not whether a record exists — nothing here tells a partner what the origin
        holds.
      </p>
      <div className="space-y-3">
        {chosen.map((p) => (
          <div key={p.partner.org_id} className="passport-card p-3">
            <div className="passport-dim mb-2 text-[13px] font-semibold">{p.partner.org_name}</div>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {EVIDENCE_CLASS_ORDER.map((cls) => {
                const s = evidenceCellState(p, cls);
                return (
                  <li key={cls} className="flex items-center justify-between gap-2">
                    <span className="passport-field__k">{EVIDENCE_CATEGORY_LABEL[cls]}</span>
                    <TonePill
                      tone={s === "available" ? "ok" : s === "unavailable" ? "warn" : "na"}
                      className="text-[10.5px]"
                    >
                      {MATRIX_CELL_LABEL[s]}
                    </TonePill>
                  </li>
                );
              })}
            </ul>
            {p.evidence.delivery === "request_required" && (
              <p className="passport-faint mt-2 text-[11px] leading-relaxed">
                Documents are reached through the existing records-request path — the partner asks,
                and the origin releases. Nothing is copied into the partner’s portal.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── step 6: confirm ──────────────────────────────────────────────────── */

function StepConfirm({
  chosen, readiness, error,
}: {
  chosen: ReadinessView[];
  readiness: PassportDistributionReadinessResponse;
  error: string | null;
}) {
  return (
    <div>
      <SectionTitle>Confirm sharing</SectionTitle>
      <p className="passport-faint mb-3 text-[11px] leading-relaxed">
        Passport {readiness.passport.version != null ? `v${readiness.passport.version}` : ""} will be
        linked to {chosen.length} partner{chosen.length === 1 ? "" : "s"}. Each partner is checked
        again at the moment of sharing, and each is recorded on the case history under its own legal
        route.
      </p>
      <ul className="space-y-1.5">
        {chosen.map((p) => (
          <li key={p.partner.org_id} className="passport-card flex flex-wrap items-center justify-between gap-2 p-3">
            <span className="passport-dim text-[13px]">{p.partner.org_name}</span>
            <span className="passport-faint text-[11px]">
              {portalLabel(p.partner.portal_type)} · {routeLabel(p.legal_route)}
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <p className="passport-faint mt-3 text-[11px] leading-relaxed">
          <span className="passport-dim font-semibold">Not shared.</span> {error}
        </p>
      )}
    </div>
  );
}

/* ── step 7: per-partner results (§7) ─────────────────────────────────── */

function StepResult({
  result, chosen,
}: {
  result: PassportShareResponse;
  chosen: ReadinessView[];
}) {
  const routeOf = (orgId: string | null | undefined) =>
    chosen.find((c) => c.partner.org_id === orgId)?.legal_route ?? null;
  const nameOf = (orgId: string | null | undefined) =>
    chosen.find((c) => c.partner.org_id === orgId)?.partner.org_name ?? "Partner";

  return (
    <div>
      <SectionTitle>Result</SectionTitle>
      <p className="passport-faint mb-3 text-[11px] leading-relaxed">
        {result.summary.shared} shared · {result.summary.already_current} already current ·{" "}
        {result.summary.blocked} needing action. Each partner is reported on its own — one partner
        failing never counts as another succeeding.
      </p>
      <ul className="space-y-2">
        {result.outcomes.map((o, i) => (
          <li key={`${o.partner_org_id ?? i}`} className="passport-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="passport-dim text-[13px] font-semibold">{nameOf(o.partner_org_id)}</span>
              <TonePill tone={outcomeTone(o)}>{outcomeLabel(o, routeOf(o.partner_org_id))}</TonePill>
            </div>
            {o.note && <p className="passport-faint mt-1.5 text-[11px] leading-relaxed">{o.note}</p>}
            {o.access_token && (
              <div className="mt-2">
                <div className="passport-field__k">Partner access token — shown once</div>
                <div className="passport-mono passport-dim mt-1 break-all text-[11px]">
                  {o.access_token}
                </div>
                <p className="passport-faint mt-1 text-[11px] leading-relaxed">
                  Give this to the partner through your existing secure channel. It is stored only as
                  a hash and cannot be shown again.
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
