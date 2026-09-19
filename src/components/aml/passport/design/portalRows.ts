/**
 * Which portals hold this Passport, and what each has done with it.
 *
 * Separate from the component so it is testable and so the strip file exports
 * only components (react-refresh). Every row is derived from the projection —
 * there is no fixture here and no portal that merely "should" exist.
 */
import type { PassportView } from "@/lib/aml/passport";
import { formatPassportDate } from "../format";
import type { PassportTone } from "./primitives";

export type PortalRow = {
  key: string;
  label: string;
  role: string;
  state: string;
  tone: PassportTone;
  detail: string;
};

const PORTAL_LABEL: Record<string, string> = {
  finance: "Finance Portal",
  solicitor: "Solicitor Portal",
  builder: "Builder Portal",
  developer: "Developer Portal",
};

/**
 * Command is always present — it is the issuing authority. The client row is
 * present whenever the case has an issued attestation, because that is what
 * makes a client Passport exist. Partner rows come from actual grants.
 */
export function derivePortalRows(view: PassportView): PortalRow[] {
  const rows: PortalRow[] = [
    {
      key: "command",
      label: "Command Centre",
      role: "Issuer",
      state: view.header.state.label,
      tone: "warn",
      detail: `Master authority · ${view.header.current_version_label ?? "not issued"}`,
    },
  ];

  const issued = view.versions.some((v) => v.issued_at);
  rows.push({
    key: "client",
    label: "Client Portal",
    role: "Subject",
    state: issued ? "Available" : "Not issued",
    tone: issued ? "ok" : "na",
    detail: issued
      ? "The client can read their own Passport."
      : "No version has been issued yet.",
  });

  for (const p of view.partners ?? []) {
    const revoked = Boolean(p.grant_revoked_at);
    const accepted = p.assessment_status === "satisfied";
    rows.push({
      key: `${p.portal_type ?? p.org_type ?? "partner"}-${p.org_name ?? ""}`,
      label: PORTAL_LABEL[p.portal_type ?? ""] ?? p.org_name ?? "Partner",
      role: p.legal_route === "reliance" ? "Reliance" : "Recipient",
      state: revoked ? "Revoked" : accepted ? "Reliance accepted" : "Passport available",
      tone: revoked ? "bad" : accepted ? "ok" : "info",
      detail: [
        p.org_name,
        p.version_label ? `reviewed ${p.version_label}` : null,
        p.grant_created_at ? `shared ${formatPassportDate(p.grant_created_at)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  return rows;
}
