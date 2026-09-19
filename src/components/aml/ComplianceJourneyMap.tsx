import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  FileText, ShieldCheck, BadgeCheck, Share2, User, Landmark, HardHat,
  Scale, Check, Circle,
} from "lucide-react";
import type { AmlCase } from "@/lib/aml/amlCasesApi";
import { stageStates } from "@/lib/aml/journeyMapStages.pure";
import { amlRelianceApi, type IndependentAssessment, type RelianceGrant } from "@/lib/aml/amlRelianceApi";

/**
 * Compliance Journey Map — the owner's portal flow diagram, rendered as a
 * living surface at the top of every case.
 *
 * Four stages across the top (Submit → Verify → Approve → Share) and the
 * portal tiles beneath, each fed from data the module already records. This
 * component COMPUTES nothing about compliance — every state shown here is a
 * projection of decisions made elsewhere (the service gate is still only ever
 * moved by an explicit human decision; a partner's assessment is still only
 * ever theirs). It is a map, not a control panel.
 *
 * Styling: semantic tokens only, per FRONTEND_TOOLING.md — no raw palette
 * classes, so the map inherits both themes for free.
 */

/* The node states are derived in `journeyMapStages.pure.ts` — each node
 * answered by its own dimension (decision ≠ gate ≠ sharing), pinned by
 * tests there. This component only renders the answer. */

const STAGES = [
  { icon: FileText, label: "Client submits", sub: "KYC & onboarding" },
  { icon: ShieldCheck, label: "We verify", sub: "identity · screening" },
  { icon: BadgeCheck, label: "Approved", sub: "human decision" },
  { icon: Share2, label: "Shared", sub: "one process, every portal" },
] as const;

interface PortalTile {
  key: string;
  label: string;
  icon: typeof User;
  status: string;
  tone: "done" | "progress" | "idle";
}

/**
 * The organisation types each PORTAL serves.
 *
 * ── One tile per portal, not per organisation type ────────────────────
 * Builders and developers sign into the SAME portal — the
 * Builder/Developer portal. `partnerOnboarding.pure.ts` removed that split
 * from the onboarding wizard for the same reason ("two doors into one
 * room"), and the map kept it: a "Developer portal" tile stood beside a
 * "Builder portal" tile, and it could never light up, because there is no
 * Developer portal to connect to. The AML server's vocabulary still
 * carries both organisation types — `organisation_type`, `portal_type`,
 * the builder portal's own `org_type` — and both belong to this one tile,
 * so a partner recorded as a developer lights the portal they actually
 * sign into rather than vanishing from the map.
 */
const PORTAL_ORG_TYPES: Record<string, string[]> = {
  finance: ["finance"],
  builder: ["builder", "developer"],
  solicitor_conveyancer: ["solicitor_conveyancer"],
};

function portalTiles(
  caseRow: AmlCase, grants: RelianceGrant[], assessments: IndependentAssessment[],
): PortalTile[] {
  const liveGrants = grants.filter((g) => !g.revoked_at);
  const orgTypes = (key: string) => PORTAL_ORG_TYPES[key] ?? [key];
  /** Live Passport grants held by any organisation type this portal serves. */
  const byPortal = (key: string) =>
    liveGrants.filter((g) =>
      orgTypes(key).includes(String(g.reliance_agreements?.partner_org_type)));
  const assessed = (key: string) =>
    assessments.some((a) =>
      a.status === "satisfied" &&
      byPortal(key).some((g) => g.agreement_id === (a as any).agreement_id));

  /**
   * ── When a portal reads GREEN ─────────────────────────────────────
   * A live Passport grant is the outcome the whole journey exists to
   * produce — "one process, every portal". It was drawn in `progress`
   * blue while the Client portal went green on completing its own part,
   * so a case whose Passport had actually reached three partners looked
   * unfinished on the very map that exists to show it had not been done
   * three times.
   *
   * Green here says the same thing the Client portal's green says: this
   * portal's part of the one process is done, and the partner can read
   * the record. It is deliberately NOT a claim about that partner's own
   * compliance — the status wording stays a fact about ACCESS, and the
   * older "Partner assessment satisfied" wording carried exactly that
   * risk, which is why the assessment is now an addition to the access
   * fact rather than a replacement for it.
   */
  const partnerTile = (key: string, label: string, icon: typeof User): PortalTile => {
    const live = byPortal(key).length > 0;
    if (live) {
      return {
        key, label, icon, tone: "done",
        status: assessed(key) ? "Passport live · partner assessed" : "Passport live",
      };
    }
    return { key, label, icon, status: "Not yet connected", tone: "idle" };
  };

  const portal = String(caseRow.client_portal_status ?? "not_started");
  const finance = String(caseRow.finance_portal_status ?? "not_requested");

  return [
    {
      key: "client", label: "Client portal", icon: User,
      status: portal === "complete" ? "Complete"
        : ["submitted", "under_review"].includes(portal) ? "Submitted"
        : portal === "in_progress" ? "In progress" : "Invited",
      tone: portal === "complete" ? "done"
        : portal === "not_started" ? "idle" : "progress",
    },
    /* Finance keeps its own middle state: the case row records that the
       portal was REQUESTED, which the partner tiles have no equivalent of.
       A live Passport still outranks it and reads green like the rest. */
    byPortal("finance").length > 0
      ? partnerTile("finance", "Finance portal", Landmark)
      : {
        key: "finance", label: "Finance portal", icon: Landmark,
        status: finance === "not_requested" ? "Not yet connected" : finance.replace(/_/g, " "),
        tone: finance === "not_requested" ? "idle" : "progress",
      },
    partnerTile("builder", "Builder / Developer portal", HardHat),
    partnerTile("solicitor_conveyancer", "Solicitors & conveyancers", Scale),
  ];
}

export function ComplianceJourneyMap({ caseRow }: { caseRow: AmlCase }) {
  const [grants, setGrants] = useState<RelianceGrant[]>([]);
  const [assessments, setAssessments] = useState<IndependentAssessment[]>([]);
  const [hasAttestation, setHasAttestation] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      amlRelianceApi.listGrants(caseRow.id).catch(() => ({ grants: [] })),
      amlRelianceApi.listAssessments(caseRow.id).catch(() => ({ assessments: [] })),
      amlRelianceApi.listAttestations(caseRow.id).catch(() => ({ attestations: [] })),
    ]).then(([g, a, at]) => {
      if (!alive) return;
      setGrants(g.grants ?? []);
      setAssessments(a.assessments ?? []);
      setHasAttestation((at.attestations ?? []).some((x: any) => !x.superseded_at));
    });
    return () => { alive = false; };
  }, [caseRow.id]);

  const states = stageStates(caseRow, hasAttestation, grants.filter((g) => !g.revoked_at).length);
  const tiles = portalTiles(caseRow, grants, assessments);
  const doneCount = states.filter((s) => s === "done").length;

  return (
    <Card className="overflow-hidden border-primary/20">
      <CardContent className="p-5">
        {/* ── the journey ─────────────────────────────────────────────── */}
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Compliance journey</h3>
          <Badge variant="outline" className="text-xs text-muted-foreground">
            One completed process · reused across all portals
          </Badge>
        </div>

        <ol className="relative mt-4 grid grid-cols-4 gap-2" aria-label="Compliance journey stages">
          {/* connector rail: track + progress fill */}
          <div aria-hidden className="absolute left-[12.5%] right-[12.5%] top-5 h-1 rounded-full bg-muted" />
          <div
            aria-hidden
            className="absolute left-[12.5%] top-5 h-1 rounded-full bg-primary transition-all duration-700"
            style={{ width: `${(Math.max(doneCount - 0.5, 0) / 4) * 100}%`, maxWidth: "75%" }}
          />
          {STAGES.map((stage, i) => {
            const state = states[i];
            const Icon = stage.icon;
            return (
              <li key={stage.label} className="relative z-10 flex flex-col items-center text-center">
                <span
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full border-2 bg-card transition-colors",
                    state === "done" && "border-primary bg-primary text-primary-foreground",
                    state === "active" && "border-primary text-primary animate-pulse",
                    state === "todo" && "border-border text-muted-foreground",
                  )}
                  aria-hidden
                >
                  {state === "done" ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </span>
                <span className={cn(
                  "mt-2 text-xs font-medium",
                  state === "todo" ? "text-muted-foreground" : "text-foreground",
                )}>
                  {stage.label}
                </span>
                <span className="text-[10px] text-muted-foreground">{stage.sub}</span>
                <span className="sr-only">
                  {state === "done" ? "complete" : state === "active" ? "in progress" : "not started"}
                </span>
              </li>
            );
          })}
        </ol>

        {/* ── the portals ─────────────────────────────────────────────
            Four, not five: Builder and Developer are one portal, and a
            "Developer portal" tile that can never connect described a door
            that does not exist. */}
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <div
                key={tile.key}
                className={cn(
                  "rounded-lg border p-2.5 text-center transition-colors",
                  tile.tone === "done" && "border-success/40 bg-success/5",
                  tile.tone === "progress" && "border-primary/40 bg-primary/5",
                  tile.tone === "idle" && "border-border/60",
                )}
              >
                <Icon className={cn(
                  "mx-auto h-4 w-4",
                  tile.tone === "done" ? "text-success"
                    : tile.tone === "progress" ? "text-primary" : "text-muted-foreground",
                )} aria-hidden />
                <div className="mt-1 truncate text-[11px] font-medium" title={tile.label}>
                  {tile.label}
                </div>
                <div className={cn(
                  "flex items-center justify-center gap-1 text-[10px]",
                  tile.tone === "done" ? "text-success"
                    : tile.tone === "progress" ? "text-primary" : "text-muted-foreground",
                )}>
                  {tile.tone === "done"
                    ? <Check className="h-2.5 w-2.5" aria-hidden />
                    : <Circle className="h-2 w-2" aria-hidden />}
                  <span className="truncate" title={tile.status}>{tile.status}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
