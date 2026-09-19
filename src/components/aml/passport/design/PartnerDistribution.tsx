/**
 * Partner Distribution — the everyday operator surface.
 *
 * This is where a Compliance Passport reaches the Finance, Solicitor /
 * Conveyancer and Builder / Developer portals. It sits inside the Passport
 * itself rather than beside it, because distributing the record is part of
 * reading the record, not a separate application.
 *
 * Everything visible here is derived by the server
 * (`get_passport_distribution_readiness`). This component chooses layout and
 * wording; it never decides whether a partner may receive anything, which
 * legal route applies, or what evidence is authorised. When the server says a
 * partner is not ready, the action is disabled and the outstanding items are
 * shown — the button is not re-enabled by anything on this side.
 *
 * The advanced governance surfaces (Compliance Sharing, partner
 * administration, agreements, assessments, grants, record requests, evidence
 * delivery) are untouched and remain the place for the technical view. This is
 * the guided path over the same backend; there is no second rule set.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { amlRelianceApi, type PassportDistributionReadinessResponse } from "@/lib/aml/amlRelianceApi";
import {
  buildMatrix,
  canShare,
  distributionSummary,
  isBulkEligible,
  evidenceSummary,
  isAdvisory,
  portalLabel,
  primaryActionLabel,
  readinessChecklist,
  routeExplanation,
  routeLabel,
  stateLabel,
  stateTone,
  summaryLine,
  BLOCKER_TITLE,
  type ReadinessView,
} from "@/lib/aml/passport/distributionPresentation.pure";
import { NoRecord, PageHead, PassportCard, SectionTitle, TonePill } from "./primitives";
import { LinkAndShareDialog } from "./LinkAndShareDialog";

export function PartnerDistribution({
  caseId,
  isMlro,
  onShared,
}: {
  caseId: string;
  isMlro: boolean;
  onShared?: () => void;
}) {
  const [data, setData] = useState<PassportDistributionReadinessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<"forbidden" | "error" | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [preselect, setPreselect] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await amlRelianceApi.getPassportDistributionReadiness(caseId);
      setData(res);
      setFailure(null);
    } catch (e: unknown) {
      // A non-MLRO reading the Passport is an ordinary, expected outcome —
      // the section simply does not apply to them. It is not an error state.
      const msg = e instanceof Error ? e.message : "";
      setFailure(/MLRO|403|forbidden/i.test(msg) ? "forbidden" : "error");
      // Deliberately NOT clearing `data`: a failed refresh must not discard
      // the readiness already on screen, nor an open dialog's result.
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  // Only the MLRO can read this, so anybody else must not send the request at
  // all: a predictable 403 on every Passport open is noise in the audit log
  // and tells the operator nothing they are not already being shown.
  useEffect(() => { if (isMlro) void load(); }, [load, isMlro]);

  const partners = data?.partners ?? [];
  // The bulk action is narrower than the per-card one — see `isBulkEligible`.
  const eligible = useMemo(() => partners.filter(isBulkEligible), [partners]);

  if (!isMlro) {
    return (
      <PassportCard>
        <SectionTitle>Partner distribution</SectionTitle>
        <p className="passport-faint text-[11px] leading-relaxed">
          Distributing a Passport to a partner portal is an MLRO decision. Partner access already
          granted is shown below.
        </p>
      </PassportCard>
    );
  }

  // Only the FIRST load blanks the surface. A refresh after a share must keep
  // the section mounted: blanking it here unmounts the Link & Share dialog
  // mid-flow and destroys the per-partner result the operator has not read yet
  // — the one screen that says which partners actually received the Passport.
  if (loading && !data) {
    return (
      <PassportCard>
        <div className="passport-faint flex items-center gap-2 text-xs" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Checking partner readiness…
        </div>
      </PassportCard>
    );
  }

  if (failure === "forbidden") return null;

  if (failure === "error" && !data) {
    return (
      <PassportCard>
        <SectionTitle>Partner distribution</SectionTitle>
        <p className="passport-faint text-[11px]">
          Partner readiness could not be checked just now.{" "}
          <button type="button" className="underline" onClick={() => void load()}>Try again</button>
        </p>
      </PassportCard>
    );
  }

  if (data && !data.enabled) {
    // Feature-off behaviour is stated plainly rather than hidden: an operator
    // who cannot see the section would otherwise assume the partners are
    // ineligible, which is a different and wrong conclusion.
    return (
      <PassportCard>
        <SectionTitle>Partner distribution</SectionTitle>
        <p className="passport-faint text-[11px] leading-relaxed">
          Guided partner distribution is not enabled for this environment. Partner access remains
          available through Compliance Sharing, and nothing about existing grants has changed.
        </p>
      </PassportCard>
    );
  }

  return (
    <section aria-labelledby="passport-distribution-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="passport-kicker">Link &amp; share</div>
          <h3 id="passport-distribution-heading" className="passport-display mt-1 text-lg font-semibold">
            Partner distribution
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="passport-faint text-xs">
            {summaryLine(data?.summary ?? { total: 0, ready: 0, already_current: 0, blocked: 0 })}
          </span>
          {eligible.length > 0 && (
            <button
              type="button"
              className="passport-action passport-action--primary w-auto"
              onClick={() => { setPreselect(eligible.map((p) => p.partner.org_id ?? "")); setShareOpen(true); }}
            >
              <span aria-hidden="true">◈</span> Share with all eligible partners
            </button>
          )}
        </div>
      </div>

      {partners.length === 0 ? (
        <NoRecord>
          No partner organisations are linked to this matter yet. A partner appears here once it is
          linked to the matter in partner administration — a firm named only in free text on a
          transaction is deliberately not turned into an organisation.
        </NoRecord>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {partners.map((p) => (
              <PartnerReadinessCard
                key={p.partner.org_id ?? p.partner.org_name ?? Math.random().toString(36)}
                readiness={p}
                onShare={() => {
                  setPreselect(p.partner.org_id ? [p.partner.org_id] : []);
                  setShareOpen(true);
                }}
              />
            ))}
          </div>

          {partners.length > 1 && <DistributionMatrix partners={partners} />}
        </>
      )}

      {shareOpen && data && (
        <LinkAndShareDialog
          caseId={caseId}
          readiness={data}
          preselected={preselect ?? []}
          onClose={() => setShareOpen(false)}
          onCompleted={() => { void load(); onShared?.(); }}
        />
      )}
    </section>
  );
}

/* ── one partner (§5) ─────────────────────────────────────────────────── */

function PartnerReadinessCard({
  readiness,
  onShare,
}: {
  readiness: ReadinessView;
  onShare: () => void;
}) {
  const rows = readinessChecklist(readiness);
  const outstanding = readiness.blockers.filter((b) => !isAdvisory(b));
  const advisories = readiness.blockers.filter(isAdvisory);
  const shareable = canShare(readiness);

  return (
    <PassportCard pending={!readiness.ready}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="passport-dim text-sm font-semibold">
            {readiness.partner.org_name ?? "Unnamed organisation"}
          </div>
          <div className="passport-faint mt-0.5 text-[11px]">
            {portalLabel(readiness.partner.portal_type)}
            {readiness.partner.relationship_role ? ` · ${readiness.partner.relationship_role}` : ""}
          </div>
        </div>
        <TonePill tone={stateTone(readiness.state)}>{stateLabel(readiness.state)}</TonePill>
      </div>

      <dl className="space-y-0">
        {rows.map((r) => (
          <div
            key={r.label}
            className="passport-rule flex items-baseline justify-between gap-3 border-b py-1.5 last:border-b-0"
          >
            <dt className="passport-field__k">{r.label}</dt>
            <dd className="flex items-center gap-1.5">
              {/* Status is carried by the word as well as the tone — never by
                  colour alone. */}
              <TonePill tone={r.tone} className="text-[10.5px]">{r.value}</TonePill>
            </dd>
          </div>
        ))}
      </dl>

      <p className="passport-faint mt-3 text-[11px] leading-relaxed">
        {routeExplanation(readiness.legal_route)}
      </p>

      {outstanding.length > 0 && (
        <div className="mt-3">
          <SectionTitle>Outstanding</SectionTitle>
          <ul className="space-y-1.5">
            {outstanding.map((b) => (
              <li key={b} className="passport-faint text-[11px] leading-relaxed">
                <span className="passport-dim font-semibold">{BLOCKER_TITLE[b]}</span>
                {" — "}
                {readiness.messages[readiness.blockers.indexOf(b)] ?? ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {advisories.length > 0 && (
        <div className="mt-3">
          <SectionTitle>Worth knowing</SectionTitle>
          <ul className="space-y-1.5">
            {advisories.map((b) => (
              <li key={b} className="passport-faint text-[11px] leading-relaxed">
                <span className="passport-dim font-semibold">{BLOCKER_TITLE[b]}</span>
                {" — "}
                {readiness.messages[readiness.blockers.indexOf(b)] ?? ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="passport-action passport-action--primary w-auto"
          disabled={!shareable}
          aria-disabled={!shareable}
          onClick={onShare}
        >
          {primaryActionLabel(readiness)}
        </button>
      </div>
    </PassportCard>
  );
}

/* ── the cross-partner matrix (§6) ────────────────────────────────────── */

export function DistributionMatrix({ partners }: { partners: ReadinessView[] }) {
  const rows = buildMatrix(partners);
  return (
    <PassportCard>
      <SectionTitle>Distribution matrix</SectionTitle>
      <p className="passport-faint mb-3 text-[11px] leading-relaxed">
        What each partner is authorised to receive, side by side. Every cell is read from the
        canonical record — nothing here is a display preference, and changing what a partner
        receives means changing the arrangement, not this table.
      </p>
      {/* Wide content scrolls inside its own container rather than the page. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <caption className="sr-only">
            Partner distribution matrix: authorised evidence and legal route by partner
          </caption>
          <thead>
            <tr>
              <th scope="col" className="passport-field__k py-2 pr-3 align-bottom">Item</th>
              {partners.map((p) => (
                <th
                  key={p.partner.org_id ?? p.partner.org_name}
                  scope="col"
                  className="passport-field__k py-2 pr-3 align-bottom"
                >
                  {p.partner.org_name ?? "—"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="passport-rule border-b last:border-b-0">
                <th scope="row" className="passport-field__k py-1.5 pr-3 font-normal">{row.label}</th>
                {row.cells.map((c, i) => (
                  <td key={`${row.label}-${c.orgId ?? i}`} className="py-1.5 pr-3">
                    <TonePill tone={c.tone} className="text-[10.5px]">{c.value}</TonePill>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PassportCard>
  );
}
