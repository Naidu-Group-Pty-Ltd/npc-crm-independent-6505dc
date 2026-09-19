/**
 * The Compliance Passport workspace — the design's page shell.
 *
 * This is the whole Passport surface for one customer: the identity strip, the
 * page rail, the controls, and whichever of the twelve pages is open. It is a
 * *dedicated* surface rather than a section embedded in the case workspace,
 * which is the architectural point — the case workspace is where compliance
 * work is DONE, and the Passport is the record that work produces. Mixing them
 * was what made the Passport read as a tab rather than as an artefact.
 *
 * Data comes from one projection call (`get_passport_view`). The pages are
 * pure functions of it, so the shell owns all the state there is: which page
 * is open, whether the version register is expanded, and whether the booklet is
 * being viewed.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { PassportStamp, PassportView } from "@/lib/aml/passport";
import { amlRelianceApi } from "@/lib/aml/amlRelianceApi";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { classifyPassportLoadFailure, passportSurfaceState } from "../loadState";
import { formatPassportDate } from "../format";
import { PassportControls } from "../PassportControls";
import { PassportStateBadge } from "../PassportStateBadge";
import { PassportBooklet } from "./PassportBooklet";
import { PassportCoverThumb } from "./PassportBook";
import { PassportPortalStrip, StampRecordDialog } from "./PassportPortals";
import { RequestClientInformationDialog } from "./RequestClientInformationDialog";
import { ComplianceActionSummary } from "./ComplianceActionSummary";
import { PASSPORT_PAGES } from "./pageRegister";


export function PassportWorkspace({
  caseId,
  initialPage = "journey",
  onOpenCase,
}: {
  caseId: string;
  initialPage?: string;
  /**
   * Navigate to the case workspace. Supplied by the PAGE, which is what owns
   * the route — this component must render without a Router (it is mounted
   * bare in tests, and a router hook here turns a presentation shell into
   * something that throws outside one). Absent, the bridge is simply not
   * offered rather than offered and broken.
   */
  onOpenCase?: (caseId: string) => void;
}) {
  const access = useAmlAccess();
  const [view, setView] = useState<PassportView | null>(null);
  const [failure, setFailure] = useState<"disabled" | "error" | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageId, setPageId] = useState(initialPage);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [bookletOpen, setBookletOpen] = useState(false);
  const [openStamp, setOpenStamp] = useState<PassportStamp | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);

  // `async` + try/catch rather than a promise chain, deliberately: the chain
  // form makes a mocked rejection surface as an unhandled rejection under the
  // test harness even though it is demonstrably caught. See loadState.test.ts.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { passport } = await amlRelianceApi.getPassportView(caseId);
      setView(passport);
      setFailure(null);
    } catch (e: unknown) {
      setFailure(classifyPassportLoadFailure(e).kind);
      setView(null);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  const pages = useMemo(
    () => PASSPORT_PAGES.filter((p) => !p.commandOnly || view?.audience === "command"),
    [view?.audience],
  );

  const active = pages.find((p) => p.id === pageId) ?? pages[0];

  const surface = passportSurfaceState({ failure, loading, hasView: Boolean(view) });

  // The flag being off is not an error and must not paint one: with
  // aml_passport_command_view off the server answers passport_disabled and
  // this surface renders nothing at all.
  if (surface === "hidden") return null;

  if (surface === "loading") {
    return (
      <div className="passport-scope rounded-xl p-8">
        <div className="passport-muted text-sm">Opening Passport…</div>
      </div>
    );
  }

  if (surface === "error" || !view || !active) {
    return (
      <div className="passport-scope rounded-xl p-8">
        <div className="passport-dim text-sm">The Compliance Passport could not be loaded.</div>
        <button type="button" className="passport-action mt-3 w-auto" onClick={() => { void load(); }}>
          Retry
        </button>
      </div>
    );
  }

  const h = view.header;
  const ActivePage = active.Component;

  return (
    <div className="passport-scope overflow-hidden rounded-xl">
      {/* ── identity strip ── */}
      <section className="passport-shell__strip flex flex-wrap items-stretch gap-4 px-5">
        <div className="flex flex-1 items-center gap-4 py-4" style={{ flexBasis: "min(100%, 420px)" }}>
          {/* The record shows the document, not a stand-in for it. This is the
              same `BookletCover` the booklet opens on, scaled — so the
              miniature and the page it opens can never disagree, and the
              emblem, frame, gold and type are the approved cover's rather
              than a second drawing of them.

              The control OVERLAYS the cover rather than wrapping it: a button
              may only contain phrasing content, and the board is a <section>
              of headings and figures. */}
          <span className="passport-cover-thumb__slot flex-none">
            <PassportCoverThumb view={view} />
            <button
              type="button"
              onClick={() => setBookletOpen(true)}
              aria-label="View the digital passport"
              className="passport-cover-thumb__open"
            />
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="passport-display text-xl font-semibold sm:text-2xl">
                {h.subject ?? "Unnamed customer"}
              </h1>
              {h.subject_type && (
                <span className="passport-gold-text rounded border border-[color:var(--passport-border-gold)] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em]">
                  {h.subject_type}
                </span>
              )}
            </div>
            <div className="passport-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="passport-mono passport-dim">{h.credential ?? "Not issued"}</span>
              <span className="passport-faint">/</span>
              <span>AML case {h.case_reference ?? "—"}</span>
              <span className="passport-faint">/</span>
              <span>Issued by {h.issuer_org}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 py-4">
          <PassportStateBadge state={h.state} />
          <button
            type="button"
            onClick={() => setVersionsOpen((v) => !v)}
            className="passport-action w-auto"
            aria-expanded={versionsOpen}
          >
            <span className="passport-mono passport-gold-text text-[13px] font-semibold">
              {h.current_version_label ?? "—"}
            </span>
            <span className="passport-faint text-[10px]">CURRENT VERSION</span>
            <span aria-hidden="true" className="passport-faint text-[10px]">▾</span>
          </button>
          <button
            type="button"
            onClick={() => setBookletOpen(true)}
            className="passport-action passport-action--primary w-auto"
          >
            <span aria-hidden="true">◈</span> View digital passport
          </button>
        </div>
      </section>

      {versionsOpen && (
        <div className="px-5 pt-4">
          <div className="passport-panel passport-fade p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="passport-display text-base font-semibold">Version register</h2>
              <p className="passport-faint max-w-[52ch] text-xs">
                An issued version is immutable. Material change supersedes it and issues a new
                version; partners are notified that the version they reviewed is obsolete.
              </p>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {view.versions.map((v) => (
                <div key={v.version} className="passport-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="passport-mono passport-gold-text text-[15px] font-semibold">
                      {v.label ?? `v${v.version}`}
                    </span>
                    <span className="passport-faint text-[9.5px] font-bold uppercase tracking-[0.1em]">
                      {v.state.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="passport-muted mt-2 text-xs">
                    {v.issued_at ? formatPassportDate(v.issued_at) : "—"}
                  </div>
                  <div className="passport-mono passport-faint mt-1 text-[11px]">
                    {v.fingerprint_short ?? "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <PassportPortalStrip view={view} />

      {/* ── shell: rail + page ── */}
      <div className="flex flex-col gap-5 p-5 lg:flex-row">
        <aside className="w-full flex-none lg:w-[248px]">
          <nav className="passport-rail p-2.5" aria-label="Passport pages">
            <div className="mb-2 flex items-center justify-between px-1.5">
              <span className="passport-kicker">Passport pages</span>
              <span className="passport-mono passport-faint text-[11px]">{pages.length}</span>
            </div>
            <ul className="space-y-0.5">
              {pages.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="passport-rail__item"
                    aria-current={p.id === active.id ? "page" : undefined}
                    onClick={() => setPageId(p.id)}
                  >
                    <span className="passport-rail__n">{p.n}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{p.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mt-3">
            <PassportControls
              caseId={caseId}
              view={view}
              isMlro={access.isMlro}
              onChanged={() => { void load(); }}
              // Sharing is a PAGE, not an anchor: Partner Access already holds
              // the readiness cards and Link & Share, so the control selects it
              // rather than scrolling at a DOM id that is not on this surface.
              onShare={() => setPageId("partners")}
              onRequestClientInformation={() => setRequestOpen(true)}
            />
          </div>
        </aside>

        <main className={cn("min-w-0 flex-1", "passport-fade")}>
          {/* The answer to "what is stopping this?", above the page content.
              Command audience only: the client's own Passport is a record, not
              a work queue, and this names whose move it is internally. */}
          {view.audience === "command" && (
            <ComplianceActionSummary
              view={view}
              onRequestClientInformation={() => setRequestOpen(true)}
              onOpenPage={(id) => setPageId(id)}
              onOpenCase={onOpenCase ? () => onOpenCase(caseId) : undefined}
            />
          )}
          <div key={active.id} className="passport-fade">
          <ActivePage
            view={view}
            caseId={caseId}
            isMlro={access.isMlro}
            onChanged={() => { void load(); }}
            onOpenBooklet={() => setBookletOpen(true)}
            onOpenStamp={(code: string) =>
              setOpenStamp(view.stamps.find((s) => s.code === code) ?? null)
            }
          />
          </div>
        </main>
      </div>

      {requestOpen && (
        <RequestClientInformationDialog
          caseId={caseId}
          view={view}
          onClose={() => setRequestOpen(false)}
          onSent={() => { void load(); }}
        />
      )}
      {bookletOpen && <PassportBooklet view={view} onClose={() => setBookletOpen(false)} />}
      {openStamp && (
        <StampRecordDialog
          stamp={openStamp}
          issuerOrg={view.header.issuer_org}
          onClose={() => setOpenStamp(null)}
        />
      )}
    </div>
  );
}
