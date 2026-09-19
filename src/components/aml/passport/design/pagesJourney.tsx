/**
 * Passport pages 00–05 — the journey and the assessment record.
 *
 * Each page is a pure function of the `PassportView` projection. None of them
 * fetches, and none decides what may be disclosed: the projection has already
 * removed anything this audience may not see, so a page cannot leak by
 * forgetting a check. Adding a page means adding a component here and an entry
 * to `PASSPORT_PAGES` — nothing else.
 */
import { cn } from "@/lib/utils";
import type { PassportView } from "@/lib/aml/passport";
import { summariseIdv } from "@/lib/aml/passport";
import { formatPassportDate, formatPassportDateTime } from "../format";
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
  Wax,
  type PassportTone,
} from "./primitives";

export type PassportPageProps = {
  view: PassportView;
  onOpenBooklet?: () => void;
  /** Stamps page only — opens the record a seal was earned from. */
  onOpenStamp?: (code: string) => void;
  /**
   * Partner Access page only — the case the Passport belongs to, the viewer's
   * MLRO standing, and a way to refetch after a distribution.
   *
   * Optional because eleven of the twelve pages are pure functions of the
   * projection and must stay that way. Distribution is the one page that acts
   * as well as reads, and it still decides nothing itself — every answer comes
   * from the server.
   */
  caseId?: string;
  isMlro?: boolean;
  onChanged?: () => void;
};

const dash = (v: string | null | undefined) => (v && v.length > 0 ? v : "—");

/* ── 00 · AML/CTF Journey ─────────────────────────────────────────────── */

export function JourneyPage({ view, onOpenBooklet }: PassportPageProps) {
  const { journey } = view;
  return (
    <div>
      <PageHead
        kicker="Source of truth"
        title="AML/CTF Journey"
        meta={`${journey.recorded} of ${journey.total} milestones recorded`}
        action={
          onOpenBooklet && (
            <button type="button" className="passport-action passport-action--primary w-auto" onClick={onOpenBooklet}>
              <span aria-hidden="true">◈</span> Open digital passport
            </button>
          )
        }
      />

      <PassportCard className="mb-5 flex flex-wrap items-start gap-3">
        <span aria-hidden="true" className="passport-gold-text text-lg leading-none">◈</span>
        <div className="min-w-0 flex-1">
          <div className="passport-dim text-sm font-semibold">
            The Passport is generated from this journey — it is not a separate record.
          </div>
          <p className="passport-muted mt-1 text-xs leading-relaxed">
            Every milestone below writes its evidence, status, actor and stamp into the
            authoritative Passport. Nothing here is entered twice.
          </p>
        </div>
      </PassportCard>

      <div className="space-y-6">
        {journey.phases.map((phase) => (
          <section key={phase.phase}>
            <div className="mb-3 flex items-center gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  "passport-phase-dot",
                  phase.recorded === phase.total && "passport-phase-dot--complete",
                )}
              />
              <h3 className="passport-kicker" style={{ letterSpacing: "0.16em" }}>
                {phase.label}
              </h3>
              <span className="passport-faint passport-mono text-xs">
                {phase.recorded}/{phase.total}
              </span>
            </div>

            <ol className="space-y-2.5">
              {phase.milestones.map((m) => (
                <li key={m.code}>
                  <PassportCard pending={!m.recorded} className="flex flex-wrap items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "passport-mono passport-ordinal",
                        m.recorded && "passport-ordinal--recorded",
                      )}
                    >
                      {m.ordinal}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="passport-dim text-sm font-semibold">{m.title}</span>
                        <TonePill tone={m.recorded ? "ok" : "na"}>
                          {m.recorded ? "Recorded" : "Pending"}
                        </TonePill>
                      </div>
                      <p className="passport-muted mt-1 text-xs leading-relaxed">{m.detail}</p>
                      <div className="passport-faint mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                        <span>{m.portal}</span>
                        <span>{m.recorded ? dash(m.actor) : "Not yet recorded"}</span>
                        <span className="passport-mono">
                          {m.at ? formatPassportDateTime(m.at) : "—"}
                        </span>
                        <span className="passport-gold-text">↳ Populates {m.feeds}</span>
                      </div>
                    </div>
                  </PassportCard>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ── 01 · Overview ────────────────────────────────────────────────────── */

export function OverviewPage({ view }: PassportPageProps) {
  const h = view.header;
  const components: Array<{ label: string; tone: PassportTone; status: string }> = [
    {
      label: "Identity & entity",
      tone: view.identity.fields.length > 0 ? "ok" : "na",
      status: view.identity.fields.length > 0 ? "Recorded" : "Not recorded",
    },
    {
      label: "Verification",
      tone: view.verification.parties.some((p) => p.verified) ? "ok" : "na",
      status: `${view.verification.parties.filter((p) => p.verified).length}/${view.verification.parties.length} verified`,
    },
    {
      label: "Ownership & control",
      tone: view.ownership.length > 0 && view.ownership.every((o) => o.verified) ? "ok" : view.ownership.length > 0 ? "info" : "na",
      status: view.ownership.length > 0 ? `${view.ownership.filter((o) => o.verified).length}/${view.ownership.length} verified` : "Not recorded",
    },
    ...(view.screening
      ? [{
          label: "Screening",
          tone: (view.screening.performed ? "ok" : "na") as PassportTone,
          status: view.screening.performed ? "Performed" : "Not performed",
        }]
      : []),
    ...(view.funding
      ? [{
          label: "Funding",
          tone: (view.funding.sof_verified > 0 ? "ok" : "na") as PassportTone,
          status: `${view.funding.sof_verified}/${view.funding.sof_total} evidenced`,
        }]
      : []),
    {
      label: "Evidence",
      tone: view.documents.length > 0 ? "ok" : "na",
      status: `${view.documents.filter((d) => d.status === "accepted").length}/${view.documents.length} accepted`,
    },
  ];

  return (
    <div>
      <PageHead kicker="Compliance summary" title="Overview" meta={h.credential ?? undefined} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {components.map((c) => (
          <PassportCard key={c.label} className="flex items-center justify-between gap-3">
            <span className="passport-dim text-[13px] font-semibold">{c.label}</span>
            <TonePill tone={c.tone}>{c.status}</TonePill>
          </PassportCard>
        ))}
      </div>

      <PassportCard className="mb-5">
        <SectionTitle>Evidence fingerprint</SectionTitle>
        <FieldGrid>
          <Field k="Credential" v={dash(h.credential)} mono />
          <Field k="Current version" v={dash(h.current_version_label)} mono />
          <Field k="Fingerprint" v={dash(h.evidence_fingerprint_short)} mono />
          <Field k="First issued" v={h.first_issued_at ? formatPassportDate(h.first_issued_at) : "—"} />
          <Field k="Issuer" v={h.issuer_org} />
          <Field k="Responsible officer" v={dash(h.officer_label)} />
        </FieldGrid>
      </PassportCard>

      <PassportNote title="What this attests">
        The issuer certifies that the customer due diligence recorded in this Passport was carried
        out under its AML/CTF programme. An issued version is immutable; material change supersedes
        it and issues a new version.
      </PassportNote>
    </div>
  );
}

/* ── 02 · Identity ────────────────────────────────────────────────────── */

export function IdentityPage({ view }: PassportPageProps) {
  const fields = view.identity.fields;
  return (
    <div>
      <PageHead kicker="Who this is" title="Identity" meta={`${fields.length} attributes`} />
      {fields.length === 0 ? (
        <NoRecord>No identity attributes have been recorded on this case yet.</NoRecord>
      ) : (
        <PassportCard>
          <FieldGrid>
            {fields.map((f) => (
              <Field key={f.key} k={f.label} v={f.value} />
            ))}
          </FieldGrid>
        </PassportCard>
      )}
      <div className="mt-5">
        <PassportNote title="Identifier handling">
          Full identifiers are held in the case record and are never rendered on a disclosure
          surface. What appears here is the attribute set approved for the Passport.
        </PassportNote>
      </div>
    </div>
  );
}

/* ── 03 · Verification (the IDV surface) ──────────────────────────────── */

const IDV_TONE: Record<string, PassportTone> = {
  passed: "ok",
  failed: "bad",
  pending: "info",
  not_performed: "na",
};

const IDV_LABEL: Record<string, string> = {
  passed: "Passed",
  failed: "Failed",
  pending: "In progress",
  not_performed: "Not performed",
};

export function VerificationPage({ view }: PassportPageProps) {
  const parties = view.verification.parties;
  return (
    <div>
      <PageHead
        kicker="How it was proven"
        title="Verification"
        meta={`${parties.filter((p) => p.verified).length} of ${parties.length} parties verified`}
      />

      {parties.length === 0 ? (
        <NoRecord>No verification checks have been recorded for this case.</NoRecord>
      ) : (
        <div className="space-y-3">
          {parties.map((p) => {
            // The page asks the IDV binding what the components mean — it never
            // switches on a raw check_type. See passportIdv.pure.ts.
            const idv = summariseIdv(
              p.components.map((c) => ({
                check_type: c.check_type,
                status: c.status,
                completed_at: c.completed_at,
              })),
            );
            return (
              <PassportCard key={p.party}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="passport-dim text-sm font-semibold">{p.party}</div>
                    <div className="passport-faint mt-0.5 text-[11px]">
                      {dash(p.method)}
                      {p.completed_at ? ` · ${formatPassportDateTime(p.completed_at)}` : ""}
                    </div>
                  </div>
                  <TonePill tone={p.verified ? "ok" : "info"}>
                    {p.verified ? "Verified" : "Incomplete"}
                  </TonePill>
                </div>

                <div className="space-y-0">
                  {idv.components.map((c) => (
                    <RecordRow
                      key={c.component.code}
                      title={c.component.label}
                      detail={c.component.meaning}
                      tone={IDV_TONE[c.outcome]}
                      status={IDV_LABEL[c.outcome]}
                    />
                  ))}
                </div>

                {idv.unmapped > 0 && (
                  <p className="passport-faint mt-2 text-[11px]">
                    {idv.unmapped} further check{idv.unmapped === 1 ? "" : "s"} recorded on this
                    party are not part of the published component set.
                  </p>
                )}
              </PassportCard>
            );
          })}
        </div>
      )}

      <div className="mt-5">
        <PassportNote title="Not part of the Passport" tone="red">
          Match scores, liveness measurements and captured biometric media stay inside the
          verification record. The Passport carries whether a component was performed and whether it
          passed — never the measurement behind it.
        </PassportNote>
      </div>
    </div>
  );
}

/* ── 04 · Ownership & Control ─────────────────────────────────────────── */

export function OwnershipPage({ view }: PassportPageProps) {
  const rows = view.ownership;
  const ubos = rows.filter((r) => r.is_ubo);
  return (
    <div>
      <PageHead
        kicker="Who controls it"
        title="Ownership & Control"
        meta={rows.length > 0 ? `${ubos.length} beneficial owner${ubos.length === 1 ? "" : "s"}` : undefined}
      />

      {rows.length === 0 ? (
        <NoRecord>
          No ownership or control parties are recorded. For an individual customer this is expected.
        </NoRecord>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <PassportCard>
              <div className="passport-field__k">Parties traced</div>
              <div className="passport-display mt-1 text-2xl">{rows.length}</div>
            </PassportCard>
            <PassportCard>
              <div className="passport-field__k">Beneficial owners</div>
              <div className="passport-display mt-1 text-2xl">{ubos.length}</div>
            </PassportCard>
            <PassportCard>
              <div className="passport-field__k">Verified</div>
              <div className="passport-display mt-1 text-2xl">
                {rows.filter((r) => r.verified).length}/{rows.length}
              </div>
            </PassportCard>
          </div>

          <PassportCard>
            {rows.map((r) => (
              <RecordRow
                key={`${r.name}-${r.party_kind}`}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {r.name}
                    {r.is_ubo && <TonePill tone="warn" glyph={false}>UBO</TonePill>}
                  </span>
                }
                detail={
                  [
                    r.relationship,
                    r.control_type,
                    r.ownership_percent != null ? `${r.ownership_percent}%` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || r.party_kind
                }
                tone={r.verified ? "ok" : "info"}
                status={r.verified ? "Verified" : dash(r.verification_state)}
              />
            ))}
          </PassportCard>
        </>
      )}
    </div>
  );
}

/* ── 05 · Screening ───────────────────────────────────────────────────── */

export function ScreeningPage({ view }: PassportPageProps) {
  const s = view.screening;
  if (!s) {
    return (
      <div>
        <PageHead kicker="Against what" title="Screening" />
        <NoRecord>Screening is not part of this Passport projection.</NoRecord>
      </div>
    );
  }
  const lists = Object.entries(s.list_freshness);
  return (
    <div>
      <PageHead
        kicker="Against what"
        title="Screening"
        meta={s.performed ? `${s.subjects_completed}/${s.subjects_total} parties` : "Not performed"}
      />

      <PassportCard className="mb-4">
        <FieldGrid>
          <Field k="Screening performed" v={s.performed ? "Yes" : "No"} />
          <Field k="Parties screened" v={`${s.subjects_completed} of ${s.subjects_total}`} />
          <Field
            k="Last completed"
            v={s.last_completed_at ? formatPassportDateTime(s.last_completed_at) : "—"}
          />
          <Field k="PEP determination" v={s.pep_result ? "Recorded" : "—"} />
        </FieldGrid>
      </PassportCard>

      {lists.length > 0 && (
        <PassportCard className="mb-4">
          <SectionTitle>List currency</SectionTitle>
          {lists.map(([name, at]) => (
            <RecordRow key={name} title={name.toUpperCase()} detail={formatPassportDate(at)} tone="ok" status="Current" />
          ))}
        </PassportCard>
      )}

      <PassportNote title="Internal boundary — not part of the Passport" tone="red">
        Candidate matches, dismissed hits, the reviewer's deliberation and any resulting suspicion
        assessment are internal compliance material. They are never carried into a Passport
        projection, a partner disclosure or a client view — the Passport records only that screening
        was performed and that the case was cleared to proceed.
      </PassportNote>
    </div>
  );
}

/* ── seals shown on the assessment pages ──────────────────────────────── */

export function PageSeal({
  title,
  caption,
  tone,
  earned,
}: {
  title: string;
  caption: string;
  tone: "gold" | "green" | "navy" | "blue" | "red";
  earned: boolean;
}) {
  return (
    <div className="flex justify-center py-4">
      <Wax tone={tone} title={title} caption={caption} earned={earned} size={96} />
    </div>
  );
}
