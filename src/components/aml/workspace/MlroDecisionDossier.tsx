/**
 * The MLRO decision dossier — every fact a decision-maker needs, in one
 * place, BY REFERENCE.
 *
 * ── Why "by reference" is the whole design ─────────────────────────────
 * A decision-maker used to have to walk eleven sections and hold the
 * answers in their head. The obvious fix — copy the answers into a
 * "dossier" record — is the wrong one: a copied fact is a second truth
 * that starts drifting the moment the underlying evidence changes, and an
 * MLRO deciding from a stale snapshot is materially worse than one
 * clicking through tabs.
 *
 * So this component stores nothing and fetches nothing. Every group below
 * is rendered from the facts the workspace already loaded, each group says
 * which canonical source it read, and each opens the section where the
 * evidence itself lives. Summary → evidence without leaving the dossier;
 * evidence → its own section in one click.
 *
 * ── It is not a decision ───────────────────────────────────────────────
 * Nothing here clears, blocks, escalates or moves the service gate. The
 * decision controls are the existing, server-authorised controls in Risk &
 * decision, with their existing rationale requirements and their existing
 * step-up authentication. A dossier that looked complete has never been,
 * and must never become, a reason to skip any of that.
 */
import { ArrowRight, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { displayDateTime } from "@/lib/aml/displayDate";
import { cn } from "@/lib/utils";
import type { AmlCaseEvent } from "@/lib/aml/amlCasesApi";
import { CASE_STAGE_LABELS, SERVICE_GATE_LABELS, caseStage, serviceGateStatus } from "@/lib/aml/caseDimensions";
import {
  EVIDENCE_STATE_LABELS,
  type AmlEvidenceState,
  type AmlServiceReadiness,
  type AmlWorkspaceFacts,
  type AmlWorkspaceSection,
} from "@/lib/aml/workspaceViewModel";

import { EVIDENCE_ICON, EVIDENCE_TEXT } from "./attentionTone";

interface DossierGroup {
  key: string;
  title: string;
  state: AmlEvidenceState;
  headline: string;
  /** The itemised evidence, revealed on demand. */
  lines: string[];
  /** Which canonical read produced this group. */
  source: string;
  section: AmlWorkspaceSection;
  sectionLabel: string;
}

const loaded = <T,>(v: T | null | undefined): v is T => v !== null && v !== undefined;

const UNREAD: Pick<DossierGroup, "state" | "headline" | "lines"> = {
  state: "unknown",
  headline: "Could not be read",
  lines: ["This source was not available. Treat it as unknown, not as satisfied."],
};

function identityGroup(facts: AmlWorkspaceFacts): DossierGroup {
  const base = {
    key: "identity",
    title: "Customer identity",
    source: "aml-verification list_verification_checks",
    section: "identity" as const,
    sectionLabel: "Identity verification",
  };
  if (!loaded(facts.identity)) return { ...base, ...UNREAD };

  const live = facts.identity.checks.filter((c) => !c.superseded_at);
  const passed = live.filter((c) => c.status === "passed");
  const referred = live.filter((c) => c.status === "referred");
  const failed = live.filter((c) => c.status === "failed" || c.status === "exhausted");

  return {
    ...base,
    state:
      live.length === 0
        ? "not_started"
        : referred.length > 0 || failed.length > 0
          ? "attention"
          : passed.length === live.length
            ? "complete"
            : "in_progress",
    headline:
      live.length === 0
        ? "No verification attempt recorded"
        : `${passed.length} of ${live.length} parties verified`,
    lines: live.map(
      (c) =>
        `${c.party_label ?? "Party"} — ${String(c.check_type ?? "verification").replace(/_/g, " ")} · ${c.status}${
          c.processing_status ? ` (${String(c.processing_status).replace(/_/g, " ")})` : ""
        }`,
    ),
  };
}

function screeningGroup(facts: AmlWorkspaceFacts): DossierGroup {
  const base = {
    key: "screening",
    title: "Screening",
    source: "aml-cases list_party_screening",
    section: "ownership" as const,
    sectionLabel: "Screening & ownership",
  };
  if (!loaded(facts.screening)) return { ...base, ...UNREAD };

  const subjects = facts.screening.subjects.filter((s) => s.state !== "not_required");
  const confirmed = subjects.filter((s) => s.state === "confirmed_match");
  const possible = subjects.filter((s) => s.state === "possible_match");
  const openMatches = subjects.reduce(
    (n, s) => n + (s.matches ?? []).filter((m) => m.status === "open").length,
    0,
  );

  return {
    ...base,
    state:
      subjects.length === 0
        ? "not_started"
        : confirmed.length > 0 || possible.length > 0 || openMatches > 0
          ? "attention"
          : "complete",
    headline:
      subjects.length === 0
        ? "No screening subjects recorded"
        : confirmed.length > 0
          ? `${confirmed.length} confirmed match${confirmed.length === 1 ? "" : "es"}`
          : openMatches > 0 || possible.length > 0
            ? `${Math.max(possible.length, openMatches)} unresolved match${Math.max(possible.length, openMatches) === 1 ? "" : "es"}`
            : `${subjects.length} screened, no open matches`,
    lines: subjects.map(
      (s) =>
        `${s.screened_name ?? "Subject"} — ${String(s.state).replace(/_/g, " ")}${
          (s.matches ?? []).length > 0 ? ` · ${(s.matches ?? []).length} candidate(s)` : ""
        }`,
    ),
  };
}

function ownershipGroup(facts: AmlWorkspaceFacts): DossierGroup {
  const base = {
    key: "ownership",
    title: "Ownership & control",
    source: "aml-entities list_entities_for_case",
    section: "ownership" as const,
    sectionLabel: "Screening & ownership",
  };
  if (facts.caseRow.subject_type === "individual") {
    return {
      ...base,
      state: "not_applicable",
      headline: "Not applicable — individual customer",
      lines: ["The customer is an individual with no entity ownership structure."],
    };
  }
  if (!loaded(facts.ownership)) return { ...base, ...UNREAD };

  const links = facts.ownership.links.filter((l) => l.entity_id);
  return {
    ...base,
    state: links.length === 0 ? "attention" : "in_progress",
    headline:
      links.length === 0
        ? "No entity structure linked"
        : `${links.length} linked entit${links.length === 1 ? "y" : "ies"}`,
    lines:
      links.length === 0
        ? ["A non-individual customer needs its ownership and control mapped before a decision."]
        : links.map((l) => `Entity link — ${String(l.link_role ?? "role not recorded").replace(/_/g, " ")}`),
  };
}

function fundingGroup(facts: AmlWorkspaceFacts): DossierGroup {
  const base = {
    key: "funding",
    title: "Funding & transaction",
    source: "aml-monitoring list_sof · aml-transactions list_transactions",
    section: "finance" as const,
    sectionLabel: "Funding & finance",
  };
  if (!loaded(facts.funding)) return { ...base, ...UNREAD };

  const items = facts.funding.sources;
  const verified = items.filter((i) => i.verified);
  const transactions = facts.transactions?.transactions ?? [];

  return {
    ...base,
    state:
      items.length === 0
        ? "not_started"
        : verified.length === items.length
          ? "complete"
          : "in_progress",
    headline:
      items.length === 0
        ? "No source of funds recorded"
        : `${verified.length} of ${items.length} sources verified`,
    lines: [
      ...items.map(
        (i) =>
          `${String(i.source_type ?? "Source").replace(/_/g, " ")} — ${i.verified ? "verified" : "not verified"}${
            i.description ? ` · ${i.description}` : ""
          }`,
      ),
      ...transactions.map(
        (t) =>
          `Transaction — ${t.property_address ?? t.reference ?? "unnamed"} · ${String(t.status ?? "status not recorded").replace(/_/g, " ")}`,
      ),
    ],
  };
}

function documentsGroup(facts: AmlWorkspaceFacts): DossierGroup {
  const base = {
    key: "documents",
    title: "Documents & evidence",
    source: "aml-cases list_requirements",
    section: "documents" as const,
    sectionLabel: "Documents & evidence",
  };
  if (!loaded(facts.documents)) return { ...base, ...UNREAD };

  const all = facts.documents.requirements;
  const required = all.filter((r) => r.required !== false);
  const statusOf = (r: { status?: string | null }) => String(r.status ?? "pending");
  const accepted = required.filter((r) => ["accepted", "waived"].includes(statusOf(r)));
  const rejected = all.filter((r) => statusOf(r) === "rejected");
  const awaiting = all.filter((r) => statusOf(r) === "uploaded");

  return {
    ...base,
    state:
      all.length === 0
        ? "not_started"
        : rejected.length > 0 || awaiting.length > 0
          ? "attention"
          : required.length > 0 && accepted.length === required.length
            ? "complete"
            : "in_progress",
    headline:
      all.length === 0
        ? "No requirements set"
        : `${accepted.length} of ${required.length} required accepted`,
    lines: all.map((r) => `${r.label ?? "Requirement"} — ${statusOf(r).replace(/_/g, " ")}`),
  };
}

function clientGroup(facts: AmlWorkspaceFacts): DossierGroup {
  const base = {
    key: "client",
    title: "Client interaction",
    source: "aml-cases list_client_requests · consent_status",
    section: "requests" as const,
    sectionLabel: "Client intake",
  };
  const open = facts.openClientRequests;
  const lines: string[] = [];

  if (loaded(facts.consent)) {
    lines.push(
      facts.consent.satisfied
        ? "Required consents accepted."
        : `Consents outstanding: ${facts.consent.outstanding.length || "unknown count"}.`,
    );
  } else {
    lines.push("Consent catalogue could not be read.");
  }
  if (open === undefined) {
    lines.push("Client requests could not be read.");
  } else {
    lines.push(`${open} open request${open === 1 ? "" : "s"} with the client.`);
  }

  const consentOutstanding = loaded(facts.consent) && !facts.consent.satisfied;
  return {
    ...base,
    state:
      open === undefined && !loaded(facts.consent)
        ? "unknown"
        : consentOutstanding || (open ?? 0) > 0
          ? "attention"
          : "complete",
    headline: consentOutstanding
      ? "Consents outstanding"
      : (open ?? 0) > 0
        ? `${open} open request${open === 1 ? "" : "s"}`
        : "Nothing outstanding with the client",
    lines,
  };
}

function complianceGroup(
  facts: AmlWorkspaceFacts,
  readiness: AmlServiceReadiness,
): DossierGroup {
  const stage = caseStage(facts.caseRow);
  const gate = serviceGateStatus(facts.caseRow);
  const risk = facts.caseRow.risk_rating ?? null;

  const lines = [
    `Case stage — ${CASE_STAGE_LABELS[stage]}`,
    `Risk rating — ${risk ? risk.toUpperCase() : "Unrated"}`,
    `Service gate — ${SERVICE_GATE_LABELS[gate]}`,
    ...readiness.reasons.map((r) => `Gate reason — ${r}`),
    ...readiness.openConditions.map((c) => `Open condition — ${c.label}`),
  ];
  if (readiness.decidedAt) {
    lines.push(
      `Gate decision recorded ${displayDateTime(readiness.decidedAt)}${readiness.decidedBy ? ` by ${readiness.decidedBy}` : ""}`,
    );
  }

  return {
    key: "compliance",
    title: "Compliance state",
    source: "aml.cases dimensions · aml-risk gate_contract",
    section: "risk",
    sectionLabel: "Risk & decision",
    state:
      readiness.level === "ready" || readiness.level === "ready_with_controls"
        ? "complete"
        : readiness.level === "blocked"
          ? "attention"
          : "in_progress",
    headline: readiness.label,
    lines,
  };
}

export interface MlroDecisionDossierProps {
  facts: AmlWorkspaceFacts;
  readiness: AmlServiceReadiness;
  events: AmlCaseEvent[];
  onOpenSection: (section: AmlWorkspaceSection) => void;
  className?: string;
}

export function MlroDecisionDossier({
  facts,
  readiness,
  events,
  onOpenSection,
  className,
}: MlroDecisionDossierProps) {
  const groups: DossierGroup[] = [
    identityGroup(facts),
    screeningGroup(facts),
    ownershipGroup(facts),
    fundingGroup(facts),
    documentsGroup(facts),
    clientGroup(facts),
    complianceGroup(facts, readiness),
  ];

  const unreadable = groups.filter((g) => g.state === "unknown");
  const recent = events.slice(0, 6);

  return (
    <Card className={className}>
      <CardContent className="space-y-4 p-5">
        <div>
          <h3 className="text-sm font-semibold">MLRO decision dossier</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Every stream that bears on the decision, read from its canonical source at this moment
            — not copied, not stored, and not a decision. Record the decision with the controls in
            Risk &amp; decision below.
          </p>
        </div>

        {unreadable.length > 0 && (
          <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
            {unreadable.length} evidence stream{unreadable.length === 1 ? "" : "s"} could not be
            read ({unreadable.map((g) => g.title.toLowerCase()).join(", ")}). Unknown is not
            satisfied — check the section before deciding.
          </p>
        )}

        <ul className="divide-y divide-border/50">
          {groups.map((group) => {
            const Icon = EVIDENCE_ICON[group.state];
            return (
              <li key={group.key} className="py-2.5 first:pt-0 last:pb-0">
                <details className="group/dossier">
                  <summary className="flex cursor-pointer list-none items-start gap-2.5 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    <ChevronRight
                      aria-hidden
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open/dossier:rotate-90"
                    />
                    <Icon
                      aria-hidden
                      className={cn("mt-0.5 h-4 w-4 shrink-0", EVIDENCE_TEXT[group.state])}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium">{group.title}</span>
                        <span className={cn("text-xs", EVIDENCE_TEXT[group.state])}>
                          {EVIDENCE_STATE_LABELS[group.state]}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {group.headline}
                      </span>
                    </span>
                  </summary>

                  <div className="ml-[3.1rem] mt-2 space-y-2">
                    {group.lines.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nothing recorded.</p>
                    ) : (
                      <ul className="space-y-1">
                        {group.lines.map((line, i) => (
                          <li key={i} className="text-xs leading-snug text-muted-foreground">
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() => onOpenSection(group.section)}
                      >
                        Open {group.sectionLabel}
                        <ArrowRight aria-hidden className="ml-1 h-3 w-3" />
                      </Button>
                      <span className="text-[11px] text-muted-foreground">
                        Source: {group.source}
                      </span>
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>

        {/* ── Audit: the significant recent events, in full in Timeline ── */}
        <details className="group/audit border-t border-border/50 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <ChevronRight
              aria-hidden
              className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open/audit:rotate-90"
            />
            Recent audit events ({recent.length})
          </summary>
          {recent.length === 0 ? (
            <p className="mt-2 pl-5 text-xs text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ol className="mt-2 space-y-1.5 pl-5">
              {recent.map((event) => (
                <li key={event.id} className="text-xs leading-snug">
                  <span className="text-muted-foreground">{displayDateTime(event.created_at)}</span>
                  {" — "}
                  {event.summary}
                  {event.actor_label ? (
                    <span className="text-muted-foreground"> · {event.actor_label}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          <Button
            variant="link"
            size="sm"
            className="ml-5 mt-1 h-auto p-0 text-xs"
            onClick={() => onOpenSection("timeline")}
          >
            Open the full audit trail
            <ArrowRight aria-hidden className="ml-1 h-3 w-3" />
          </Button>
        </details>
      </CardContent>
    </Card>
  );
}
