/**
 * Passport pages 06–11 — funding, evidence, the transaction and the record
 * trail. Same contract as `pagesJourney.tsx`: pure functions of the
 * projection, no fetching, no disclosure decisions.
 */
import type { PassportView } from "@/lib/aml/passport";
import { formatPassportCurrency, formatPassportDate, formatPassportDateTime } from "../format";
import { PendingStampFace, StampFace } from "./StampFace";
import {
  Field,
  FieldGrid,
  NoRecord,
  PageHead,
  PassportCard,
  PassportNote,
  RecordRow,
  SectionTitle,
  TonePill,
  type PassportTone,
} from "./primitives";
import type { PassportPageProps } from "./pagesJourney";
import { PartnerDistribution } from "./PartnerDistribution";

const dash = (v: string | null | undefined) => (v && v.length > 0 ? v : "—");

/* ── 06 · Funding & EDD ───────────────────────────────────────────────── */

export function FundingPage({ view }: PassportPageProps) {
  const f = view.funding;
  if (!f) {
    return (
      <div>
        <PageHead kicker="Where the money is from" title="Funding & EDD" />
        <NoRecord>Funding is not part of this Passport projection.</NoRecord>
      </div>
    );
  }
  return (
    <div>
      <PageHead kicker="Where the money is from" title="Funding & EDD" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <PassportCard>
          <SectionTitle>Source of funds</SectionTitle>
          <div className="passport-display text-2xl">
            {f.sof_verified}/{f.sof_total}
          </div>
          <div className="passport-muted mt-1 text-xs">components evidenced</div>
        </PassportCard>
        <PassportCard>
          <SectionTitle>Source of wealth</SectionTitle>
          <div className="passport-display text-2xl">
            {f.sow_verified}/{f.sow_total}
          </div>
          <div className="passport-muted mt-1 text-xs">components evidenced</div>
        </PassportCard>
      </div>

      <PassportCard className="mb-4">
        <SectionTitle>Enhanced due diligence</SectionTitle>
        <RecordRow
          title="EDD assessment"
          detail={
            f.edd_present
              ? "An enhanced due diligence case exists for this customer."
              : "No enhanced due diligence case was required for this customer."
          }
          tone={f.edd_completed ? "ok" : f.edd_present ? "info" : "na"}
          status={f.edd_completed ? "Completed" : f.edd_present ? "Open" : "Not required"}
        />
      </PassportCard>

      <PassportNote title="Decision only" tone="red">
        The Passport records the funding decision and the evidence count behind it. The reviewer's
        reasoning, the risk model and any internal escalation stay in the case record.
      </PassportNote>
    </div>
  );
}

/* ── 07 · Evidence & Documents ────────────────────────────────────────── */

const DOC_TONE: Record<string, PassportTone> = {
  accepted: "ok",
  rejected: "bad",
  pending: "info",
  requested: "info",
};

export function EvidencePage({ view }: PassportPageProps) {
  const docs = view.documents;
  const accepted = docs.filter((d) => d.status === "accepted").length;

  // Grouped the way the design groups them: required evidence first, because
  // that is the set an auditor checks for completeness.
  const required = docs.filter((d) => d.required);
  const supporting = docs.filter((d) => !d.required);

  return (
    <div>
      <PageHead
        kicker="What proves it"
        title="Evidence & Documents"
        meta={`${accepted} of ${docs.length} accepted`}
      />

      {docs.length === 0 ? (
        <NoRecord>No documents have been recorded against this case.</NoRecord>
      ) : (
        <div className="space-y-4">
          {[
            { label: "Required evidence", rows: required },
            { label: "Supporting evidence", rows: supporting },
          ]
            .filter((g) => g.rows.length > 0)
            .map((g) => (
              <PassportCard key={g.label}>
                <SectionTitle>{g.label}</SectionTitle>
                {g.rows.map((d) => (
                  <RecordRow
                    key={d.id}
                    title={d.label}
                    detail={
                      [
                        d.uploaded_at ? formatPassportDate(d.uploaded_at) : null,
                        d.version_number != null ? `v${d.version_number}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                    tone={DOC_TONE[d.status] ?? "na"}
                    status={d.status}
                  />
                ))}
              </PassportCard>
            ))}
        </div>
      )}

      <div className="mt-5">
        <PassportNote title="Evidence stays where it was filed">
          The Passport lists what exists and its state. Documents are never copied into it and are
          never served from it — a reader with authority opens the original through the case record,
          and that access is logged there.
        </PassportNote>
      </div>
    </div>
  );
}

/* ── 08 · Transaction ─────────────────────────────────────────────────── */

export function TransactionPage({ view }: PassportPageProps) {
  const txs = view.transactions;
  return (
    <div>
      <PageHead
        kicker="What it is for"
        title="Transaction"
        meta={txs.length > 0 ? `${txs.length} recorded` : undefined}
      />
      {txs.length === 0 ? (
        <NoRecord>No transaction is recorded against this Passport.</NoRecord>
      ) : (
        <div className="space-y-3">
          {txs.map((t) => (
            <PassportCard key={t.id}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="passport-dim text-sm font-semibold">
                  {dash(t.property_address)}
                </span>
                <TonePill tone={t.status === "settled" ? "ok" : "info"}>
                  {dash(t.status)}
                </TonePill>
              </div>
              <FieldGrid>
                <Field k="Kind" v={dash(t.kind)} />
                <Field
                  k="Consideration"
                  v={t.purchase_price != null ? formatPassportCurrency(t.purchase_price) : "—"}
                  mono
                />
                <Field k="Contract" v={t.contract_date ? formatPassportDate(t.contract_date) : "—"} />
                <Field
                  k="Settlement"
                  v={t.settlement_date ? formatPassportDate(t.settlement_date) : "—"}
                />
              </FieldGrid>
            </PassportCard>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 09 · Partner Access ──────────────────────────────────────────────── */

const DISCLOSURE_TONE: Record<string, PassportTone> = {
  granted: "ok",
  limited: "warn",
  withheld: "na",
};

export function PartnersPage({ view, caseId, isMlro, onChanged }: PassportPageProps) {
  const partners = view.partners;
  if (!partners) {
    return (
      <div>
        <PageHead kicker="Who relies on it" title="Partner Access" />
        <NoRecord>Partner access is not part of this Passport projection.</NoRecord>
      </div>
    );
  }
  return (
    <div>
      <PageHead
        kicker="Who relies on it"
        title="Partner Access"
        meta={`${partners.length} grant${partners.length === 1 ? "" : "s"}`}
      />

      {/* Distribution — how a Passport REACHES a partner. The list below is
          what has already reached one; both read the same backend, and this
          section decides nothing on its own. */}
      {caseId && (
        <div className="mb-5">
          <PartnerDistribution
            caseId={caseId}
            isMlro={Boolean(isMlro)}
            onShared={onChanged}
          />
        </div>
      )}

      <SectionTitle>Current partner access</SectionTitle>

      {partners.length === 0 ? (
        <NoRecord>This Passport has not been shared with any partner.</NoRecord>
      ) : (
        <div className="space-y-3">
          {partners.map((p, i) => {
            const revoked = Boolean(p.grant_revoked_at);
            return (
              <PassportCard key={`${p.org_name}-${i}`}>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="passport-dim text-sm font-semibold">{dash(p.org_name)}</div>
                    <div className="passport-faint mt-0.5 text-[11px]">
                      {[dash(p.org_type), p.legal_route ?? undefined].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <TonePill tone={revoked ? "bad" : p.assessment_status === "satisfied" ? "ok" : "info"}>
                    {revoked ? "Revoked" : dash(p.assessment_status ?? p.link_state)}
                  </TonePill>
                </div>

                <FieldGrid min={130}>
                  <Field k="Shared" v={p.grant_created_at ? formatPassportDate(p.grant_created_at) : "—"} />
                  <Field k="Expires" v={p.grant_expires_at ? formatPassportDate(p.grant_expires_at) : "—"} />
                  <Field k="Version reviewed" v={dash(p.version_label)} mono />
                  <Field k="Last viewed" v={p.last_viewed_at ? formatPassportDate(p.last_viewed_at) : "—"} />
                </FieldGrid>

                <div className="mt-3">
                  <SectionTitle>Disclosure</SectionTitle>
                  {p.disclosure.length === 0 ? (
                    <p className="passport-faint text-[11px]">
                      This grant predates stored disclosure manifests, so its permitted set is not
                      recorded here. An empty matrix does not mean nothing was shared.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {p.disclosure.map((d) => (
                        <TonePill key={d.code} tone={DISCLOSURE_TONE[d.state] ?? "na"} glyph={false}>
                          {d.code}
                        </TonePill>
                      ))}
                    </div>
                  )}
                </div>
              </PassportCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── 10 · Stamps & Certifications ─────────────────────────────────────── */

/**
 * The page shows the WHOLE certification set, not only the earned part.
 *
 * Earned stamps alone cannot distinguish "this case has one certification"
 * from "this case is one of fourteen certifications through" — both draw a
 * single seal on an empty page. Production makes that concrete: of five live
 * cases the best-covered earns two stamps and one earns none. The outstanding
 * impressions are what turn a sparse page into a statement of where the case
 * actually is, and they are derived from the same facts as the earned ones so
 * the two can never disagree.
 */
export function StampsPage({ view, onOpenStamp }: PassportPageProps) {
  const stamps = view.stamps;
  const all = view.pending_stamps ?? [];
  // The design closes the page with a dedicated panel for the settlement
  // stamp, so it is drawn there rather than twice.
  const settlement = all.find((p) => p.code === "transaction_completed") ?? null;
  const pending = all.filter((p) => p !== settlement);
  const total = stamps.length + all.length;

  return (
    <div className="flex flex-col gap-5">
      <PageHead
        kicker="What it certifies"
        title="Stamps & Certifications"
        meta={
          total === 0
            ? "No certifications"
            : `${stamps.length} of ${total} earned · select a stamp for its full record`
        }
      />

      {total === 0 ? (
        <NoRecord>
          No certification applies to this case yet. A stamp appears only when a record with a
          timestamp supports it.
        </NoRecord>
      ) : (
        <div className="passport-stamp-register">
          <div className="passport-stamp-grid">
            {stamps.map((s, i) => (
              <button
                key={`${s.code}-${s.at}`}
                type="button"
                className="passport-stamp-button"
                onClick={() => onOpenStamp?.(s.code)}
                aria-label={`${s.title} — ${s.org} — ${formatPassportDateTime(s.at)}. Open the record behind this stamp.`}
              >
                <StampFace stamp={s} issuerOrg={view.header.issuer_org} index={i} />
                {/* The design captions every impression with the portal its
                    record came from — the first thing an auditor asks about a
                    stamp. */}
                <span className="passport-stamp-caption">{s.portal}</span>
              </button>
            ))}

            {/* Not yet earned. No record behind these, so nothing to open. */}
            {pending.map((p) => (
              <div key={`pending-${p.code}`} className="passport-stamp-button">
                <PendingStampFace stamp={p} />
                <span className="passport-stamp-caption">Outstanding</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The design's own closing panel, kept for the one stamp it models. */}
      {settlement && (
        <div className="passport-stamp-settlement">
          <div className="passport-stamp-settlement__die" aria-hidden="true">
            <div>
              <div className="passport-display passport-muted text-xs font-bold leading-[1.15]">
                TRANSACTION
                <br />
                COMPLETED
              </div>
              <div className="passport-mono passport-faint mt-1 text-[7.5px]">
                PENDING SETTLEMENT
              </div>
            </div>
          </div>
          <div className="min-w-0 flex-1 basis-64">
            <h3 className="passport-display passport-dim m-0 text-[15px] font-semibold">
              Final completion stamp — awaiting settlement
            </h3>
            <p className="passport-muted m-0 mt-1.5 text-xs leading-relaxed">
              {settlement.expected_at
                ? `Applied on confirmed settlement, expected ${formatPassportDate(settlement.expected_at)}.`
                : "Applied on confirmed settlement."}{" "}
              The Passport is then retained under its compliance retention period rather than
              removed from the system.
            </p>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <PassportCard>
          <div className="passport-dim text-[13px] font-semibold">
            {pending.length === 1
              ? "One certification is still outstanding"
              : `${pending.length} certifications are still outstanding`}
          </div>
          <div className="mt-2 space-y-1.5">
            {pending.map((p) => (
              <div key={`await-${p.code}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="passport-gold-text text-[11px] font-semibold uppercase tracking-[0.1em]">
                  {p.title}
                </span>
                <span className="passport-muted text-xs">{p.awaiting}</span>
                {p.expected_at && (
                  <span className="passport-mono passport-faint text-[10px]">
                    expected {formatPassportDate(p.expected_at)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </PassportCard>
      )}

      <PassportNote title="Earned, never assigned">
        Every stamp is derived from a system record and carries that record's actor, portal and
        time. There is no way to apply one by hand, and an outstanding impression stays empty
        until the record behind it exists.
      </PassportNote>
    </div>
  );
}

/* ── 11 · Passport History ────────────────────────────────────────────── */

export function HistoryPage({ view }: PassportPageProps) {
  const rows = view.history;
  return (
    <div>
      <PageHead kicker="What happened" title="Passport History" meta={`${rows.length} entries`} />
      {rows.length === 0 ? (
        <NoRecord>No history has been recorded for this Passport.</NoRecord>
      ) : (
        <PassportCard>
          {rows.map((h, i) => (
            <div
              key={h.id ?? `${h.at}-${i}`}
              className="passport-rule flex flex-wrap items-baseline gap-3 border-b py-2.5 last:border-b-0"
            >
              <span className="passport-mono passport-gold-text flex-none text-[11px]">
                {formatPassportDateTime(h.at)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="passport-dim text-[13px]">{h.title}</div>
                {h.detail && <div className="passport-muted mt-0.5 text-xs">{h.detail}</div>}
              </div>
              <span className="passport-faint text-[11px]">{h.source}</span>
            </div>
          ))}
        </PassportCard>
      )}
      <div className="mt-5">
        <PassportNote title="Append-only">
          Passport history is written from the case's hash-chained event record. Entries are never
          edited or removed — a correction is a new entry.
        </PassportNote>
      </div>
    </div>
  );
}
