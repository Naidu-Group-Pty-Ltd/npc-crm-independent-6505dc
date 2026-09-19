/**
 * Onboard a partner, grant passport access, and get them INTO their
 * portal — one guided pass, end to end.
 *
 * Chains the existing acts in the order the servers require them:
 * canonical organisation → written CDD arrangement (prebuilt for portal
 * partners — the Compliance Passport agreement their sign-up executes) →
 * case link → PORTAL ACCESS (the partner's contact receives the invite
 * email through each portal's own invite function) → COMPLIANCE-PAGE
 * ENROLMENT (the membership and the organisation binding that let them open
 * the Passport signed in) → grant, with the link emailed at mint time. The
 * final screen reports where the link went, where the invite went, and
 * whether the Passport is also on their own portal's compliance page.
 *
 * ── Portal access, per portal ─────────────────────────────────────────
 * Each portal already has an invite pipeline, and this wizard drives it
 * rather than inventing one:
 *   finance   — a `finance_agent_contacts` row, then `finance-portal-invite`
 *   builder / developer — `builder-portal-admin` (organisation →
 *               activation → user → membership), then `builder-portal-invite`
 *   solicitor — `solicitor-portal-admin` upsert_firm, then
 *               `solicitor-portal-invite` (which creates the user itself)
 * An EXISTING portal contact can be chosen instead — no re-provisioning,
 * no duplicate identities; someone who already has access is reported as
 * such rather than re-invited.
 *
 * Rules this deliberately keeps:
 *   - Every provisioning call runs under its own portal's admin
 *     permission model — a refusal surfaces with its reason.
 *   - A failed invite NEVER blocks the grant, and a grant is never
 *     re-run because an email bounced: the token screen reports the
 *     invite outcome and offers a retry that re-runs ONLY the invite.
 *   - Created records are cached per step, so retrying resumes instead
 *     of duplicating.
 *   - The server enforces every grant rule (MLRO, arrangement, review
 *     currency, client sharing consent, attestation) — nothing here
 *     bypasses one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchInput } from '@/components/ui/search-input';
import { Loader2, Copy, Check, ShieldCheck, Mail, AlertTriangle, Building2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import { amlCasesApi } from "@/lib/aml/amlCasesApi";
import {
  amlRelianceApi, type PartnerOrganisation, type RelianceAgreement,
} from "@/lib/aml/amlRelianceApi";
import {
  BUILDER_ORG_KINDS, LEGAL_ROUTE_CHOICES, PARTNER_PORTAL_CHOICES, PREBUILT_AGREEMENT_TITLE,
  amlOrgTypeForKind, builderOrgType, defaultPurpose, defaultReviewDate, grantReadiness,
  isValidEmail, isoDate, portalAsksOrgKind, portalHasPrebuiltAgreement, prebuiltArrangementDraft,
} from "@/lib/aml/partnerOnboarding.pure";

type WizardStep = "partner" | "link" | "grant" | "token" | "ack_sent";

/* Nobody types an arrangement here any more. A PORTAL partner's is the
 * prebuilt Compliance Passport agreement their sign-up executes; a partner
 * OUTSIDE the portals acknowledges the same agreement through a one-time
 * emailed link, and their acceptance is what creates it. */
const STEP_TITLES: Record<"partner" | "link" | "grant", string> = {
  partner: "The partner",
  link: "Why they may access this matter",
  grant: "Grant passport access",
};

/** An existing portal identity, offered so nobody re-provisions one. */
interface ExistingPortalContact {
  key: string;
  name: string;
  email: string;
  sub: string;
  /** Already signed in / accepted — an invite would be noise or a 409. */
  active: boolean;
  finance_contact_id?: string;
  builder_user_id?: string;
  solicitor_user_id?: string;
  firm_id?: string;
}

type InviteOutcome =
  | { state: "sent"; email: string }
  | { state: "already"; email: string }
  | { state: "failed"; email: string; detail: string }
  | { state: "skipped" }
  /* Phase 6/7 of the network extraction: the Builder / Developer Portal
     left this workspace for the Builders Network, so there is no workspace
     portal to invite a builder partner into — the emailed Passport link is
     their channel until E4's in-network compliance surface ships. */
  | { state: "portal_moved" };

/** The portal's own user table for a portal choice — never invented here. */
const PORTAL_USER_SOURCE: Record<string, "finance_portal_users" | "builder_portal_users" | "solicitor_portal_users"> = {
  finance: "finance_portal_users",
  builder: "builder_portal_users",
  developer: "builder_portal_users",
  solicitor_conveyancer: "solicitor_portal_users",
};

/** Provisioned ids, cached so a retry resumes instead of duplicating. */
interface ProvisionCache {
  financeContactId?: string;
  organisationId?: string;
  orgVersion?: number;
  orgActivated?: boolean;
  builderUserId?: string;
  firmId?: string;
  /* The portal identity this pass provisioned or reused. Enrolment maps a
     REAL portal user, so it needs the id the portal itself issued — never
     an email, which is not an identity. */
  financeUserId?: string;
  solicitorUserId?: string;
}

/** invokeSecureFunction with the error shapes collapsed to one throw. */
async function call<T = any>(fn: string, payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>(fn, payload);
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error(String((data as any).error));
  return data as T;
}

function ChoiceCard({ selected, label, meaning, onSelect }: {
  selected: boolean; label: string; meaning: string; onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "rounded-md border p-2.5 text-left transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/50",
      )}
    >
      <span className="block text-sm font-medium">{label}</span>
      <span className="block text-xs text-muted-foreground">{meaning}</span>
    </button>
  );
}

export function PartnerOnboardingWizard({
  open, onOpenChange, caseId, attestationVersion, organisations, agreements, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  /** Current attestation version on the case, null when none is issued. */
  attestationVersion: number | null;
  /** Already-recorded organisations and arrangements, for reuse. */
  organisations: PartnerOrganisation[];
  agreements: RelianceAgreement[];
  onDone: () => void | Promise<void>;
}) {
  const [step, setStep] = useState<WizardStep>("partner");
  const [busy, setBusy] = useState(false);

  /* Step 1 — the partner. Reusing a recorded organisation is offered
   * first: a free-text name is not an identity. */
  const [existingOrgId, setExistingOrgId] = useState<string | null>(null);
  const [legalName, setLegalName] = useState("");
  const [portal, setPortal] = useState(PARTNER_PORTAL_CHOICES[0].value);
  const [abn, setAbn] = useState("");

  /* Step 1 — who receives portal access. An existing portal contact can
   * be chosen; a new one needs a name and a deliverable email, because
   * the invite email IS the door into the portal. */
  const [portalContacts, setPortalContacts] = useState<ExistingPortalContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  /* A registry read that FAILED is not a registry that is empty — the
   * finance list silently rendered empty for exactly that reason. */
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [chosenContactKey, setChosenContactKey] = useState<string | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  /* Which organisation the one Builder/Developer card stands for. */
  const [builderKind, setBuilderKind] = useState<string>("builder");

  /* Step 3 — the case link. */
  const [role, setRole] = useState(PARTNER_PORTAL_CHOICES[0].role);
  const [legalRoute, setLegalRoute] = useState(LEGAL_ROUTE_CHOICES[0].value);
  const [purpose, setPurpose] = useState("");

  /* Step 4 — readiness, from the case's own record. */
  const [sharingConsent, setSharingConsent] = useState<boolean | null>(null);

  /* What each completed server act created — retrying never duplicates. */
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);
  const [createdAgreement, setCreatedAgreement] = useState<RelianceAgreement | null>(null);
  const [linkRecorded, setLinkRecorded] = useState(false);
  const provisionCache = useRef<ProvisionCache>({});
  const [inviteOutcome, setInviteOutcome] = useState<InviteOutcome | null>(null);
  /* The emailed agreement, for a partner outside the portals. */
  const [ackResult, setAckResult] = useState<{
    email: string; expires_at: string; emailSent: boolean;
    emailError: string | null; link: string;
  } | null>(null);

  /* The one-time token, shown exactly once. */
  /**
   * What the grant actually produced — including where the link WENT.
   *
   * The link and NOTHING ELSE.
   *
   * This used to carry the raw bearer token, first as the deliverable and
   * then behind a disclosure. It carries neither now, because the token and
   * the `/passport/<token>` link are the same credential — the link is that
   * token with a URL around it — and the only thing in this platform that
   * consumes it is the public page, which reads it back out of the URL.
   * Showing it a second time doubled the places a live credential was copied
   * and invited an operator to send "the code" instead of the link, which is
   * a defect this product has already had.
   */
  const [grantResult, setGrantResult] = useState<{
    link: string;
    expires_at: string;
    version: number;
    deliveredTo: string;
    emailSent: boolean | null;
    emailError: string | null;
  } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  /* Whether this partner can also open the Passport inside their own portal
     — reported, never assumed. See `enrolPortalAccess`. */
  const [portalAccess, setPortalAccess] = useState<
    | { state: "enrolled"; surfaceEnabled: boolean; bound: "already" | "set" }
    | { state: "failed"; detail: string }
    | { state: "skipped" }
    | { state: "portal_moved" }
    | null
  >(null);

  const portalChoice = PARTNER_PORTAL_CHOICES.find((p) => p.value === portal)!;
  const activeAgreements = agreements.filter((a) => a.status === "active");
  const chosenOrg = organisations.find((o) => o.id === existingOrgId) ?? null;
  const partnerName = chosenOrg?.legal_name ?? legalName.trim();
  const chosenContact = portalContacts.find((c) => c.key === chosenContactKey) ?? null;
  /* The AML vocabulary for this partner. The Builder/Developer card is
   * ONE portal, so which of AML's two types it means comes from the
   * organisation kind chosen underneath it. */
  const asksOrgKind = portalAsksOrgKind(portal);
  const amlType = asksOrgKind ? amlOrgTypeForKind(builderKind) : portal;

  /* A portal partner's arrangement is PREBUILT: the Portal Access &
   * AML/CTF Compliance Passport Agreement their sign-up executes (its
   * binding_amlctf_arrangement acknowledgement is the s 37A statement,
   * and sign-up is refused without it). The manual arrangement step
   * exists only for a partner outside the portals. */
  const prebuilt = portalHasPrebuiltAgreement(portal);
  /* A partner outside the portals signs the agreement by email. The pass
   * therefore ENDS at sending it: the passport is granted later, from the
   * workspace, once they have accepted — because waiting days for a
   * signature is not a wizard step. */
  const directAck = !prebuilt;
  const stepOrder: WizardStep[] = ["partner", "link", "grant"];
  /* An arrangement already on the register for this partner is reused
   * silently — auto or manual, one register row per partner is enough. */
  const reusableAgreement = activeAgreements.find(
    (a) => a.partner_org_name.toLowerCase() === partnerName.toLowerCase(),
  ) ?? null;

  /* Reset per open, so a second onboarding never inherits the first. */
  useEffect(() => {
    if (!open) return;
    setStep("partner");
    setExistingOrgId(null); setLegalName(""); setPortal(PARTNER_PORTAL_CHOICES[0].value); setAbn("");
    setChosenContactKey(null); setContactName(""); setContactEmail("");
    setBuilderKind("builder"); setContactSearch("");
    setPortalContacts([]); setContactsError(null); setContactsLoading(false);
    setRole(PARTNER_PORTAL_CHOICES[0].role);
    setLegalRoute(LEGAL_ROUTE_CHOICES[0].value);
    setPurpose("");
    setCreatedOrgId(null); setCreatedAgreement(null); setLinkRecorded(false);
    provisionCache.current = {};
    setInviteOutcome(null); setAckResult(null);
    setGrantResult(null); setLinkCopied(false); setPortalAccess(null);
  }, [open]);

  /* The client's sharing consent, read softly — unknown stays unknown. */
  useEffect(() => {
    if (!open) return;
    let alive = true;
    amlCasesApi.consentStatus(caseId)
      .then((res) => {
        if (!alive) return;
        const doc = (res.documents ?? []).find((d) => d.code === "compliance_sharing");
        setSharingConsent(doc ? doc.accepted_at !== null : null);
      })
      .catch(() => { if (alive) setSharingConsent(null); });
    return () => { alive = false; };
  }, [open, caseId]);

  /*
   * The EXISTING portal identities for the chosen portal, from each
   * portal's own registry — so an existing finance, builder or solicitor
   * partner is chosen, never re-created.
   *
   * ── Why finance goes through the edge function ──────────────────────
   * `finance_agent_contacts` grants SELECT to `service_role` alone, so a
   * browser read returns a permission error, not rows — and the old
   * `.catch(() => [])` turned that into an empty list. Five active
   * finance contacts existed and none was ever offered. Every portal now
   * reads through its own admin function (service role), and a read that
   * FAILED says so instead of rendering as "none".
   */
  useEffect(() => {
    if (!open || portal === "other") {
      setPortalContacts([]); setContactsError(null); setContactsLoading(false);
      return;
    }
    let alive = true;
    setContactsLoading(true);
    setContactsError(null);
    const load = async (): Promise<ExistingPortalContact[]> => {
      if (portal === "finance") {
        // `records` = every finance contact with its portal status,
        // assembled server-side (finance-portal-admin list_users).
        const res = await call<{ records: any[] }>("finance-portal-admin", { operation: "list_users" });
        return (res.records ?? [])
          .filter((c: any) => c.email && c.is_active !== false)
          .map((c: any) => ({
            key: `finance:${c.id}`, name: c.name, email: c.email,
            sub: c.company || "Finance contact",
            active: c.status === "active",
            finance_contact_id: c.id,
          }));
      }
      if (portal === "solicitor_conveyancer") {
        const res = await call<{ records: any[] }>("solicitor-portal-admin", { operation: "list_users" });
        return (res.records ?? []).filter((u: any) => u.status !== "revoked").map((u: any) => ({
          key: `solicitor:${u.id}`, name: u.name, email: u.email,
          sub: u.firm_name || "Solicitor portal user",
          active: u.status === "active",
          solicitor_user_id: u.id, firm_id: u.firm_id,
        }));
      }
      const res = await call<{ users: any[] }>("builder-portal-admin", { operation: "list_users" });
      return (res.users ?? []).filter((u: any) => u.status !== "revoked").map((u: any) => ({
        key: `builder:${u.id}`, name: u.name, email: u.email,
        sub: "Builder/Developer portal user",
        active: u.status === "active",
        builder_user_id: u.id,
      }));
    };
    load()
      .then((rows) => { if (alive) setPortalContacts(rows); })
      .catch((e: any) => {
        if (!alive) return;
        setPortalContacts([]);
        setContactsError(e?.message ?? "The existing partners could not be read.");
      })
      .finally(() => { if (alive) setContactsLoading(false); });
    return () => { alive = false; };
  }, [open, portal]);

  /* The default role and purpose follow the chosen portal until edited —
   * and a portal change clears the contact choice, which belongs to the
   * previous portal's registry. */
  const applyPortal = (value: typeof portal) => {
    const prev = PARTNER_PORTAL_CHOICES.find((p) => p.value === portal)!;
    setPortal(value);
    // The contact choice and the search belong to the previous portal's
    // registry; carrying either across would offer the wrong people.
    setChosenContactKey(null);
    setContactSearch("");
    const next = PARTNER_PORTAL_CHOICES.find((p) => p.value === value)!;
    if (role === prev.role) setRole(next.role);
  };

  /* The kind sets the role the same way the portal does: only while the
   * operator has not written their own. */
  const applyBuilderKind = (value: string) => {
    const prev = BUILDER_ORG_KINDS.find((k) => k.value === builderKind);
    setBuilderKind(value);
    const next = BUILDER_ORG_KINDS.find((k) => k.value === value);
    if (next && (role === prev?.role || role === "builder")) setRole(next.role);
  };

  const chooseContact = (contact: ExistingPortalContact) => {
    if (chosenContactKey === contact.key) {
      setChosenContactKey(null);
      return;
    }
    setChosenContactKey(contact.key);
    setContactName(contact.name ?? "");
    setContactEmail(contact.email ?? "");
  };

  const readiness = useMemo(
    () => grantReadiness({ attestationVersion, sharingConsent }),
    [attestationVersion, sharingConsent],
  );

  /* A long registry is searchable rather than a wall of cards — the
   * builder portal's user list is every builder user, not just this
   * partner's. */
  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return portalContacts;
    return portalContacts.filter(
      (c) => c.name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q));
  }, [portalContacts, contactSearch]);

  /* Everyone needs a deliverable address: a portal partner receives their
   * invite there, and a partner outside the portals receives the agreement
   * itself — which is the only way they can accept it. */
  const contactValid = chosenContact !== null
    || (contactName.trim().length > 1 && isValidEmail(contactEmail));
  const partnerValid = (existingOrgId !== null || legalName.trim().length > 1) && contactValid;
  const effectivePurpose = purpose.trim() || defaultPurpose(portalChoice.label, role);
  const linkValid = role.trim().length > 0 && effectivePurpose.length >= 10;

  /**
   * Portal access, through each portal's own pipeline. Every created id
   * is cached, so a retry resumes; an existing identity is reused; and
   * someone who already has access is reported, never re-invited.
   */
  const provisionPortalAccess = async (): Promise<InviteOutcome> => {
    if (portal === "other") return { state: "skipped" };
    /* The Builder / Developer Portal moved to the Builders Network (Phase 6)
       and its admin plane here is a frozen archive: provisioning an
       organisation, user or membership would be refused by the server, and
       an invite would open a portal that redirects away. No call is made —
       a doomed step must not be walked. The grant and its emailed link are
       untouched below. */
    if (portal === "builder" || portal === "developer") return { state: "portal_moved" };
    const cache = provisionCache.current;
    const email = (chosenContact?.email ?? contactEmail).toLowerCase().trim();
    const name = (chosenContact?.name ?? contactName).trim();
    try {
      if (portal === "finance") {
        let contactId = chosenContact?.finance_contact_id ?? cache.financeContactId;
        if (!contactId) {
          // A contact already loaded for this portal wins — the browser
          // cannot read this table itself (service_role only), so the
          // list this dialog already holds is the lookup.
          const known = portalContacts.find(
            (c) => c.email.toLowerCase() === email && c.finance_contact_id);
          if (known?.finance_contact_id) {
            contactId = known.finance_contact_id;
          } else {
            const res = await call<{ contact: { id: string } }>("finance-portal-admin", {
              operation: "create_contact", name, email, company: partnerName,
            });
            contactId = res.contact.id;
          }
          cache.financeContactId = contactId;
        }
        const status = await call<any>("finance-portal-invite", {
          action: "check_status", finance_contact_id: contactId,
        });
        cache.financeUserId = status.portal_user?.id ?? cache.financeUserId;
        if (status.has_portal_access) return { state: "already", email };
        await call("finance-portal-invite", {
          action: "invite", finance_contact_id: contactId,
          invite_mode: "set_password_link", resend_invite: Boolean(status.is_invited),
        });
        if (!cache.financeUserId) {
          // The invite CREATES the portal user, so the identity only exists
          // after it. Enrolment maps a real id and never an email.
          const after = await call<any>("finance-portal-invite", {
            action: "check_status", finance_contact_id: contactId,
          });
          cache.financeUserId = after.portal_user?.id ?? undefined;
        }
        return { state: "sent", email };
      }

      if (portal === "solicitor_conveyancer") {
        if (chosenContact?.solicitor_user_id) {
          cache.solicitorUserId = chosenContact.solicitor_user_id;
          if (chosenContact.active) return { state: "already", email };
          await call("solicitor-portal-invite", {
            action: "invite", solicitor_user_id: chosenContact.solicitor_user_id,
          });
          return { state: "sent", email };
        }
        let firmId = cache.firmId;
        if (!firmId) {
          const res = await call<{ firm_id: string }>("solicitor-portal-admin", {
            operation: "upsert_firm", name: partnerName, contact_email: email,
          });
          firmId = res.firm_id;
          cache.firmId = firmId;
        }
        // The invite function creates the portal user itself — one call,
        // and an already-known email is reused rather than duplicated.
        const invited = await call<{ solicitor_user_id?: string; user?: { id?: string } }>(
          "solicitor-portal-invite", { action: "invite", firm_id: firmId, email, name });
        cache.solicitorUserId = invited?.solicitor_user_id ?? invited?.user?.id ?? cache.solicitorUserId;
        return { state: "sent", email };
      }

      // Builder / Developer — one shared portal, typed organisations.
      let builderUserId = chosenContact?.builder_user_id ?? cache.builderUserId;
      if (chosenContact?.builder_user_id) cache.builderUserId = chosenContact.builder_user_id;
      if (chosenContact?.builder_user_id && chosenContact.active) {
        return { state: "already", email };
      }
      if (!builderUserId) {
        if (!cache.organisationId) {
          const res = await call<{ organisation: any }>("builder-portal-admin", {
            operation: "upsert_organisation",
            legal_name: partnerName, org_type: builderOrgType(builderKind), contact_email: email,
          });
          cache.organisationId = res.organisation.id;
          cache.orgVersion = res.organisation.row_version;
          cache.orgActivated = res.organisation.status === "active";
        }
        if (!cache.orgActivated) {
          const res = await call<{ organisation: any }>("builder-portal-admin", {
            operation: "set_organisation_status",
            organisation_id: cache.organisationId, status: "active",
            expected_version: cache.orgVersion,
            reason: "Activated during AML partner onboarding",
          });
          cache.orgActivated = true;
          cache.orgVersion = res.organisation?.row_version ?? cache.orgVersion;
        }
        try {
          const res = await call<{ user: any }>("builder-portal-admin", {
            operation: "create_user", email, name,
          });
          builderUserId = res.user.id;
        } catch (e: any) {
          // The email already has a portal identity — reuse it, never a twin.
          if (/already exists/i.test(String(e?.message ?? ""))) {
            const res = await call<{ users: any[] }>("builder-portal-admin", { operation: "list_users" });
            builderUserId = (res.users ?? []).find(
              (u: any) => String(u.email).toLowerCase() === email)?.id;
          }
          if (!builderUserId) throw e;
        }
        cache.builderUserId = builderUserId;
        await call("builder-portal-admin", {
          operation: "upsert_membership",
          builder_user_id: builderUserId, organisation_id: cache.organisationId,
          membership_role: "administrator", is_primary: true,
        });
      }
      try {
        await call("builder-portal-invite", { action: "invite", builder_user_id: builderUserId });
      } catch (e: any) {
        if (/already active/i.test(String(e?.message ?? ""))) return { state: "already", email };
        throw e;
      }
      return { state: "sent", email };
    } catch (e: any) {
      return { state: "failed", email, detail: e?.message ?? "The portal invite failed." };
    }
  };

  /**
   * Enrol this partner's portal identity for the in-portal compliance page.
   *
   * ── Why this act exists ───────────────────────────────────────────
   * A partner who signs into their own portal reaches the AML/CTF
   * Compliance page through `portal session → membership → canonical
   * organisation`, and that walk was broken at BOTH ends in production:
   * `aml.partner_portal_memberships` held zero rows, and the organisation
   * cross-reference columns (`builder_organisation_id`,
   * `solicitor_firm_id`, `finance_agent_contact_id`) were declared by a
   * migration and written by nothing, ever. So a partner with a working
   * login, an active arrangement, a live grant and a linked matter still
   * met "your account is not enrolled" — and, if only that were fixed,
   * "no canonical partner organisation is mapped to your organisation".
   *
   * The server does both in one operation and refuses to re-point a
   * binding that already names a different portal organisation.
   *
   * It NEVER blocks the grant. The Passport is emailed either way; this
   * decides whether they can also read it signed in, and its failure is
   * reported on the final screen rather than swallowed.
   */
  const enrolPortalAccess = async (orgId: string) => {
    if (portal === "other") { setPortalAccess({ state: "skipped" }); return; }
    // No in-portal compliance page exists here for builder partners any
    // more — the portal moved, and enrolment would map an identity into a
    // surface this workspace no longer serves.
    if (portal === "builder" || portal === "developer") {
      setPortalAccess({ state: "portal_moved" });
      return;
    }
    const source = PORTAL_USER_SOURCE[portal];
    const cache = provisionCache.current;
    /* A finance CONTACT id is not a portal USER id, and a solicitor firm is
       not a person — only the portal's own user id may be mapped, so each
       branch reads exactly the id that portal issued. */
    const portalUserId =
      source === "builder_portal_users"
        ? (cache.builderUserId ?? chosenContact?.builder_user_id)
        : source === "solicitor_portal_users"
          ? (cache.solicitorUserId ?? chosenContact?.solicitor_user_id)
          : cache.financeUserId;
    if (!portalUserId) {
      /* An identity we could not name is not an identity we may map. This is
         a real outcome — a portal whose invite creates the user lazily — and
         it is said rather than guessed at with an email address. */
      setPortalAccess({
        state: "failed",
        detail: "their portal account could not be identified yet — it is usually created when they accept the invite. Re-run this onboarding for them afterwards and it will enrol.",
      });
      return;
    }
    try {
      const res = await amlRelianceApi.enrolPartnerPortalAccess({
        partner_org_id: orgId,
        portal_user_source: source,
        portal_user_id: String(portalUserId),
        portal_type: amlType as "finance" | "builder" | "developer" | "solicitor_conveyancer",
        ...(source === "builder_portal_users" && cache.organisationId
          ? { builder_organisation_id: cache.organisationId }
          : {}),
        // The MLRO has already decided this partner may rely; an `invited`
        // state that nothing ever promotes is one more silent lock-out.
        status: "active",
      });
      setPortalAccess({
        state: "enrolled",
        surfaceEnabled: Boolean(res.surface_enabled),
        bound: res.organisation_binding?.bound ?? "already",
      });
    } catch (e: any) {
      setPortalAccess({ state: "failed", detail: e?.message ?? "the enrolment call failed." });
    }
  };

  /**
   * The chain, run when the operator confirms. Portal access is
   * provisioned BEFORE the grant — but its failure never blocks the
   * grant, because the invite is retryable from the token screen and the
   * one-time token must not be lost to a bounced email.
   */
  const completeGrant = async () => {
    setBusy(true);
    try {
      // 1 · The canonical organisation.
      let orgId = existingOrgId ?? createdOrgId;
      if (!orgId) {
        const { partner_organisation } = await amlRelianceApi.upsertPartnerOrganisation({
          legal_name: legalName.trim(),
          organisation_type: amlType,
          abn: abn.trim() || undefined,
          portal_types: portal === "other" ? [] : [amlType],
        });
        orgId = partner_organisation.id;
        setCreatedOrgId(orgId);
      }

      // 2 · The written arrangement. A PORTAL partner's is the prebuilt
      //     Compliance Passport agreement their sign-up executes, so the
      //     register row is recorded automatically. A partner OUTSIDE the
      //     portals has no sign-up: their acceptance of the emailed
      //     agreement creates the row, so nothing is recorded here.
      let agreement = createdAgreement ?? reusableAgreement;
      if (!agreement && !directAck) {
        const res = await amlRelianceApi.createAgreement({
          // The pointer that was never written. Without it the grant carries
          // no `partner_org_id`, and the partner's own portal — which looks a
          // grant up BY organisation — reports a Passport it holds as never
          // shared. See `create_agreement` for the whole story.
          partner_org_id: orgId,
          partner_org_name: partnerName,
          partner_org_type: amlType,
          partner_abn: abn.trim() || undefined,
          ...prebuiltArrangementDraft(new Date()),
        });
        agreement = res.agreement;
        setCreatedAgreement(agreement);
      } else if (agreement && !agreement.partner_org_id && !directAck) {
        /* An arrangement recorded before that pointer existed. The operator
           has selected both records in this pass, so binding them is their
           explicit act rather than a name match — and this is the repair
           path for every partner onboarded before it. The server binds once
           and refuses to re-point. */
        try {
          const bound = await amlRelianceApi.bindAgreementOrganisation(agreement.id, orgId);
          agreement = bound.agreement;
          setCreatedAgreement(agreement);
        } catch (e: any) {
          // Never fatal: the Passport still issues and still emails. It only
          // costs the in-portal route, which the final screen reports.
          console.warn("[onboarding] arrangement organisation binding skipped:", e?.message);
        }
      }

      // 3 · The case link — the recorded reason this organisation may see
      //     this matter. An existing identical link is not an error.
      if (!linkRecorded) {
        try {
          await amlRelianceApi.linkPartnerToCase({
            case_id: caseId, partner_org_id: orgId,
            portal_type: amlType, relationship_role: role.trim(),
            legal_route: legalRoute, purpose: effectivePurpose,
          });
          setLinkRecorded(true);
        } catch (e: any) {
          if (/already exists/i.test(String(e?.message ?? ""))) {
            setLinkRecorded(true);
          } else {
            throw e;
          }
        }
      }

      // 3b · A partner outside the portals: send the agreement and STOP.
      //      The passport is granted later, from the workspace, once they
      //      have accepted — because their acceptance is the arrangement,
      //      and waiting days for a signature is not a wizard step.
      if (directAck) {
        const res = await amlRelianceApi.sendPartnerAcknowledgement({
          case_id: caseId, partner_org_id: orgId,
          recipient_name: (chosenContact?.name ?? contactName).trim(),
          recipient_email: (chosenContact?.email ?? contactEmail).toLowerCase().trim(),
        });
        setAckResult({
          email: res.acknowledgement.recipient_email,
          expires_at: res.acknowledgement.expires_at,
          emailSent: res.email_sent,
          emailError: res.email_error,
          link: res.link,
        });
        setStep("ack_sent");
        await onDone();
        return;
      }

      // 4 · Portal access — the invite email, through the portal's own
      //     pipeline. A failure is reported and retryable, never fatal.
      let outcome = inviteOutcome;
      if (!outcome || outcome.state === "failed") {
        outcome = await provisionPortalAccess();
        setInviteOutcome(outcome);
      }

      // 4b · The in-portal compliance page. Runs BEFORE the grant so that
      //      the final screen can tell the operator, in one place, both
      //      where the link went and whether the partner can also read the
      //      Passport signed in. It never throws — a failed enrolment is a
      //      reported outcome, not a stopped onboarding.
      await enrolPortalAccess(orgId);

      // 5 · The grant — the server re-checks every precondition, and the
      //     link is EMAILED at mint time, the only moment it exists.
      //
      //     `deliver_to` was omitted here, and omitting it is silent: the
      //     grant succeeds, the register is correct, `delivered_to_email`
      //     is null and the partner is told nothing. The address is the one
      //     the portal invite went to, so the Passport and the account it
      //     is read alongside reach the same person.
      const deliverTo = (chosenContact?.email ?? contactEmail).toLowerCase().trim();
      const res = await amlRelianceApi.grantAccess(caseId, agreement.id, {
        deliver_to: deliverTo,
      });
      setGrantResult({
        link: res.passport_link ?? res.access_token,
        expires_at: res.grant.expires_at,
        version: res.grant.attestation_version,
        deliveredTo: res.delivered_to ?? deliverTo,
        emailSent: res.link_email_sent,
        emailError: res.link_email_error,
      });
      setStep("token");
      await onDone();
    } catch (e: any) {
      toast({
        title: "Partner onboarding stopped",
        description: `${e?.message ?? "The request failed."} What was already recorded is kept — fixing the cause and confirming again resumes from there.`,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  /** Re-runs ONLY the invite — the grant is done and stays done. */
  const retryInvite = async () => {
    setBusy(true);
    try {
      const outcome = await provisionPortalAccess();
      setInviteOutcome(outcome);
      if (outcome.state === "sent") toast({ title: "Portal invite sent", description: `Emailed ${outcome.email}.` });
    } finally {
      setBusy(false);
    }
  };

  /** The link is the artefact a person is given; the token is not. */
  const copyLink = async () => {
    if (!grantResult) return;
    try {
      await navigator.clipboard.writeText(grantResult.link);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      const field = document.getElementById("pow-passport-link") as HTMLInputElement | null;
      field?.focus();
      field?.select();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      {/*
        ── Viewport ────────────────────────────────────────────────────
        The shared dialog is `grid` and turns overflow VISIBLE at ≥sm, so
        a tall pass ran off the bottom of the screen with the Continue
        button pinned to the very edge and nothing to scroll. This owns
        its layout instead: a fixed header, ONE scrolling body, and a
        footer that is always reachable at any window height.
      */}
      <DialogContent
        className={cn(
          "flex flex-col gap-3 overflow-hidden",
          "max-h-[92dvh] sm:max-h-[88dvh] sm:max-w-2xl sm:overflow-hidden",
        )}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>
            {step === "token" ? "Partner access granted"
              : step === "ack_sent" ? "Agreement sent for acceptance"
              : "Onboard a partner & grant passport access"}
          </DialogTitle>
          <DialogDescription>
            {step === "token"
              ? "The Passport link has been emailed to the partner. A spare copy is below — it is shown once."
              : step === "ack_sent"
                ? "The partner reviews and accepts by email. The passport can be issued once they have."
                : directAck
                  ? "One pass records the organisation and the case link, then emails the partner the agreement to accept. The passport follows their acceptance."
                  : "One pass records the organisation, the arrangement and the case link, emails the portal invite, then grants access. Every rule is still enforced server-side."}
          </DialogDescription>
        </DialogHeader>

        {/* Progress — where this pass is, in words. Numbered at render
            time, because a portal partner has no arrangement step. */}
        {step !== "token" && step !== "ack_sent" && (
          <ol className="shrink-0 flex flex-wrap gap-x-3 gap-y-1 text-[11px]" aria-label="Onboarding steps">
            {stepOrder.map((s, i) => (
              <li key={s} className={cn(
                "uppercase tracking-wide",
                s === step ? "font-semibold text-primary" : "text-muted-foreground",
              )}>
                {i + 1} · {STEP_TITLES[s as Exclude<WizardStep, "token">]}
              </li>
            ))}
          </ol>
        )}

        {/* The one scrolling region: every step's content, and nothing
            else, so the footer stays put. */}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {step === "partner" && (
          <div className="space-y-3 text-sm">
            {organisations.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Use a recorded partner organisation</Label>
                <div role="radiogroup" aria-label="Recorded partner organisations" className="grid gap-2">
                  {organisations.filter((o) => o.status === "active").map((o) => (
                    <ChoiceCard
                      key={o.id}
                      selected={existingOrgId === o.id}
                      label={o.legal_name}
                      meaning={`${o.organisation_type.replace(/_/g, " ")}${o.abn ? ` · ABN ${o.abn}` : ""}`}
                      onSelect={() => setExistingOrgId(existingOrgId === o.id ? null : o.id)}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">— or record a new one below.</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pow-legal-name" className="text-xs">Legal name</Label>
              <Input
                id="pow-legal-name"
                placeholder="e.g. Meridian Finance Group Pty Ltd"
                value={legalName}
                disabled={existingOrgId !== null}
                onChange={(e) => setLegalName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Which portal will they use?</Label>
              <div role="radiogroup" aria-label="Partner portal" className="grid gap-2 sm:grid-cols-2">
                {PARTNER_PORTAL_CHOICES.map((p) => (
                  <ChoiceCard
                    key={p.value}
                    selected={portal === p.value}
                    label={p.label}
                    meaning={p.meaning}
                    onSelect={() => applyPortal(p.value)}
                  />
                ))}
              </div>
            </div>
            {/* One portal, three organisation shapes. Asked only for the
                Builder/Developer card, because the answer is written to
                the AML record, the case link and the portal itself. */}
            {asksOrgKind && (
              <div className="space-y-1.5">
                <Label className="text-xs">Which best describes them?</Label>
                <div role="radiogroup" aria-label="Organisation kind" className="grid gap-2 sm:grid-cols-3">
                  {BUILDER_ORG_KINDS.map((k) => (
                    <ChoiceCard
                      key={k.value}
                      selected={builderKind === k.value}
                      label={k.label}
                      meaning={k.meaning}
                      onSelect={() => applyBuilderKind(k.value)}
                    />
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pow-abn" className="text-xs">ABN (optional)</Label>
              <Input id="pow-abn" placeholder="11 digits" value={abn}
                disabled={existingOrgId !== null}
                onChange={(e) => setAbn(e.target.value)} />
            </div>

            {/* ── Who receives portal access ─────────────────────────── */}
            {(
              <div className="space-y-1.5 border-t border-border/50 pt-3">
                <Label className="text-xs">
                  {directAck ? "Who accepts the agreement?" : "Who receives portal access?"}
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  {directAck
                    ? "They receive the AML/CTF Compliance Passport Agreement by email and accept it there — no account, no portal. Their acceptance is what records the arrangement."
                    : `The invite email is how they get into the ${portalChoice.label} — no prior sign-up is needed. Choose an existing contact, or enter a new one.`}
                </p>
                {contactsLoading && (
                  <p className="flex items-center gap-2 text-[11px] text-muted-foreground" role="status">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    Loading existing {portalChoice.label} partners…
                  </p>
                )}
                {/* A read that FAILED is never rendered as "no partners" —
                    that silence is what hid five finance contacts. */}
                {!contactsLoading && contactsError && (
                  <p className="text-[11px] text-warning" aria-live="polite">
                    Existing partners could not be read ({contactsError}). Enter the contact
                    below to invite them — nothing is lost by doing so.
                  </p>
                )}
                {!contactsLoading && !contactsError && portalContacts.length > 6 && (
                  <SearchInput
                    value={contactSearch}
                    onValueChange={setContactSearch}
                    aria-label="Search existing partners"
                    placeholder="Search by name or email…"
                    hideIcon
                    className="h-8"
                  />
                )}
                {!contactsLoading && !contactsError && portalContacts.length > 0 && (
                  filteredContacts.length > 0 ? (
                    <div role="radiogroup" aria-label="Existing portal contacts"
                      className="grid max-h-52 gap-2 overflow-y-auto pr-1">
                      {filteredContacts.map((c) => (
                        <ChoiceCard
                          key={c.key}
                          selected={chosenContactKey === c.key}
                          label={`${c.name} — ${c.email}`}
                          meaning={`${c.sub}${c.active ? " · already has portal access" : ""}`}
                          onSelect={() => chooseContact(c)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      No existing partner matches that search.
                    </p>
                  )
                )}
                {!contactsLoading && !contactsError && portalContacts.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    No {portalChoice.label} partner has been recorded yet — enter the contact below
                    and they will be created and invited.
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pow-contact-name" className="text-xs">Contact name</Label>
                    <Input id="pow-contact-name" placeholder="e.g. Jordan Lee" value={contactName}
                      onChange={(e) => { setContactName(e.target.value); setChosenContactKey(null); }} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pow-contact-email" className="text-xs">Contact email</Label>
                    <Input id="pow-contact-email" type="email" placeholder="name@partner.com.au" value={contactEmail}
                      onChange={(e) => { setContactEmail(e.target.value); setChosenContactKey(null); }} />
                  </div>
                </div>
                {!contactValid && (contactName.length > 0 || contactEmail.length > 0) && (
                  <p className="text-[11px] text-warning" aria-live="polite">
                    {directAck
                      ? "A name and a valid email are needed — the agreement has nowhere to go without them."
                      : "A contact name and a valid email are needed — the invite has nowhere to go without them."}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {step === "link" && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              The link records why {partnerName || "this organisation"} may access this matter.
              It grants nothing by itself — the legal route is a recorded decision, never
              inferred from the portal.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="pow-role" className="text-xs">Relationship role</Label>
              <Input id="pow-role" value={role} onChange={(e) => setRole(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Legal route</Label>
              <div role="radiogroup" aria-label="Legal route" className="grid gap-2 sm:grid-cols-2">
                {LEGAL_ROUTE_CHOICES.map((r) => (
                  <ChoiceCard
                    key={r.value}
                    selected={legalRoute === r.value}
                    label={r.label}
                    meaning={r.meaning}
                    onSelect={() => setLegalRoute(r.value)}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pow-purpose" className="text-xs">Documented purpose</Label>
              <textarea
                id="pow-purpose"
                className="min-h-[56px] w-full rounded-md border border-input bg-background p-2 text-sm"
                placeholder={defaultPurpose(portalChoice.label, role)}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Left empty, the suggested wording above is recorded.
              </p>
            </div>
          </div>
        )}

        {step === "grant" && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-border/60 p-3 text-xs space-y-1">
              <div><span className="font-medium">Partner:</span> {partnerName} · {portalChoice.label}</div>
              <div>
                <span className="font-medium">Arrangement:</span>{" "}
                {reusableAgreement
                  ? `${reusableAgreement.agreement_reference} (already recorded)`
                  : prebuilt
                    ? `Prebuilt — ${PREBUILT_AGREEMENT_TITLE} (recorded automatically)`
                    : "Created when the partner accepts the emailed agreement"}
              </div>
              <div><span className="font-medium">Legal route:</span> {LEGAL_ROUTE_CHOICES.find((r) => r.value === legalRoute)?.label}</div>
              {directAck && (
                <div>
                  <span className="font-medium">Agreement to:</span>{" "}
                  {(chosenContact?.email ?? contactEmail) || "—"} — they accept by email; the
                  passport follows.
                </div>
              )}
              {!directAck && (
                <>
                  <div>
                    <span className="font-medium">Portal access:</span>{" "}
                    {portal === "builder" || portal === "developer"
                      ? "the Builder / Developer Portal has moved to the Builders Network — no workspace portal invite is sent; the emailed Passport link is how this partner reads the record."
                      : chosenContact?.active
                        ? `${chosenContact.email} already has ${portalChoice.label} access — no invite is sent.`
                        : `${(chosenContact?.email ?? contactEmail) || "—"} receives the ${portalChoice.label} invite email.`}
                  </div>
                  {/* Said BEFORE the click, because the invite and the
                      Passport are two different emails and a partner who
                      already had portal access used to receive neither. */}
                  <div>
                    <span className="font-medium">Passport link:</span>{" "}
                    emailed to {(chosenContact?.email ?? contactEmail) || "—"} — a separate email
                    from the portal invite, and the only way they reach this record.
                  </div>
                </>
              )}
              <div>
                <span className="font-medium">They will receive:</span>{" "}
                {directAck
                  ? "the agreement now; the passport (what was performed, never this case's risk assessment) once they accept."
                  : `attestation v${attestationVersion ?? "—"} — what was performed, never this case's risk assessment.`}
              </div>
            </div>
            {readiness.blockers.map((b) => (
              <p key={b} className="text-[11px] text-warning">{b}</p>
            ))}
            {readiness.cautions.map((c) => (
              <p key={c} className="text-[11px] text-muted-foreground">{c}</p>
            ))}
            {prebuilt && !reusableAgreement && (
              <p className="text-xs text-muted-foreground">
                No arrangement to type: the partner&apos;s binding acknowledgement of that
                agreement — including the s&nbsp;37A arrangement statement — is a mandatory part
                of their portal sign-up, and the executed copy lands in Partner Agreement
                Records.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Confirming records anything not yet recorded, emails the portal invite, then
              grants access and shows the partner&apos;s one-time token. The client sees their
              completed compliance in their own portal — nothing extra is asked of them.
            </p>
          </div>
        )}

        {step === "ack_sent" && ackResult && (
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/5 p-3">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              <p className="text-xs">
                The AML/CTF Compliance Passport Agreement has been sent to{" "}
                <span className="font-medium">{ackResult.email}</span> for acceptance. They need no
                account — the link opens the agreement itself, and it expires{" "}
                {new Date(ackResult.expires_at).toLocaleDateString('en-AU')}.
              </p>
            </div>
            {/* The passport is deliberately NOT issued yet: their acceptance
                is what creates the arrangement a grant requires. */}
            <p className="text-xs text-muted-foreground">
              No passport has been issued and nothing has been shared. When they accept, the
              arrangement is recorded, you are notified, and the passport can be granted from this
              stage. If they decline or the link lapses, you can send it again — to the same
              address or a different one.
            </p>
            {!ackResult.emailSent && (
              <div className="space-y-1.5 rounded-md border border-warning/40 bg-warning/5 p-3">
                <p className="text-xs text-warning">
                  The request was recorded, but the email did not send
                  {ackResult.emailError ? `: ${ackResult.emailError}` : "."} The link below is live —
                  deliver it to the partner yourself, or re-send from this stage.
                </p>
                <code className="block break-all rounded border border-border/60 bg-muted/40 p-2 text-[11px]">
                  {ackResult.link}
                </code>
              </div>
            )}
          </div>
        )}

        {step === "token" && grantResult && (
          <div className="space-y-3 text-sm">
            {/* Delivery first, because delivery is the thing that was
                missing. A grant nobody was emailed is access with no
                channel, and it reads identically to a healthy one in every
                register — so this states what became of the email rather
                than assuming it went. */}
            <div className={cn(
              "flex items-start gap-2 rounded-md border p-3",
              grantResult.emailSent === false
                ? "border-warning/40 bg-warning/5"
                : "border-success/40 bg-success/5",
            )}>
              {grantResult.emailSent === false
                ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />}
              <p className="text-xs">
                {grantResult.emailSent === false ? (
                  <>
                    {partnerName} holds a grant on attestation v{grantResult.version}, but the email
                    to <span className="font-medium">{grantResult.deliveredTo}</span> did not send
                    {grantResult.emailError ? ` (${grantResult.emailError})` : ""}. Copy the link
                    below and send it yourself — it is shown once and cannot be read again.
                  </>
                ) : (
                  <>
                    The Passport link has been emailed to{" "}
                    <span className="font-medium">{grantResult.deliveredTo}</span>. It opens the
                    whole record without a portal login, on attestation v{grantResult.version},
                    until {new Date(grantResult.expires_at).toLocaleDateString('en-AU')} — they see what
                    was performed, never this case&apos;s risk assessment.
                  </>
                )}
              </p>
            </div>

            {/* The invite outcome — reported honestly, retryable in place. */}
            {inviteOutcome?.state === "sent" && (
              <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/5 p-3">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                <p className="text-xs">
                  Portal invite emailed to <span className="font-medium">{inviteOutcome.email}</span>.
                  They set their password from the link and, as part of sign-up, acknowledge the
                  prebuilt Compliance Passport agreement — nothing more is needed from you.
                </p>
              </div>
            )}
            {inviteOutcome?.state === "already" && (
              <div className="flex items-start gap-2 rounded-md border border-border/60 p-3">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-xs">
                  <span className="font-medium">{inviteOutcome.email}</span> already has portal
                  access — no invite was sent.
                </p>
              </div>
            )}
            {inviteOutcome?.state === "failed" && (
              <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
                <div className="flex min-w-0 items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  <p className="text-xs">
                    The grant succeeded, but the portal invite to{" "}
                    <span className="font-medium">{inviteOutcome.email}</span> did not:{" "}
                    {inviteOutcome.detail}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={retryInvite} disabled={busy}>
                  {busy && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                  Retry portal invite
                </Button>
              </div>
            )}
            {inviteOutcome?.state === "portal_moved" && (
              <div className="flex items-start gap-2 rounded-md border border-border/60 p-3">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-xs">
                  No workspace portal invite was sent: the Builder / Developer Portal now lives at
                  the Builders Network. The emailed Passport link below is how this partner reads
                  the record — nothing more is needed from you.
                </p>
              </div>
            )}

            {/* ── the artefact a PERSON is given ───────────────────────
                The link, held as a real value in a read-only field: it can
                be selected, it can be copied, and it is what the partner
                opens. Nothing an everyday operator does requires the token
                underneath it. */}
            <div className="space-y-1.5">
              <Label htmlFor="pow-passport-link" className="text-xs">
                Their Passport link — a spare copy, shown once
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="pow-passport-link"
                  readOnly
                  value={grantResult.link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-xs"
                />
                <Button size="sm" variant="outline" className="shrink-0"
                  onClick={copyLink} aria-label="Copy Passport link">
                  {linkCopied
                    ? <><Check className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copied</>
                    : <><Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copy</>}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Only its hash is stored, so it can never be read again — but nothing is lost if
                you close this: the Passport can be re-issued to them at any time from
                &ldquo;Who holds this Passport&rdquo; in the case workspace.
              </p>
            </div>

            {/* ── where else they can read it ──────────────────────────
                The link is a delivery; a portal is a place you go back to.
                A partner who already holds a portal account should not have
                to keep an email to re-read a record they are entitled to
                rely on — so this says, plainly and only when it is true,
                that the same Passport is on their own AML/CTF Compliance
                page. Enrolment is reported rather than assumed: a failure
                here never blocks the grant, and it is actionable. */}
            {portalAccess?.state === "enrolled" && portalAccess.surfaceEnabled && (
              <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/5 p-3">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                <p className="text-xs">
                  They can also open this Passport inside the {portalChoice.label} — it is on their
                  own <span className="font-medium">AML/CTF Compliance</span> page, signed in, with
                  no link to keep.
                </p>
              </div>
            )}
            {portalAccess?.state === "enrolled" && !portalAccess.surfaceEnabled && (
              <div className="flex items-start gap-2 rounded-md border border-border/60 p-3">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-xs">
                  They are enrolled for the {portalChoice.label} compliance page, but that surface is
                  switched off on this deployment — so the emailed link is the only way they reach
                  this Passport today. Nothing more is needed from you.
                </p>
              </div>
            )}
            {portalAccess?.state === "failed" && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                <p className="text-xs">
                  The Passport was issued and emailed. They could not be enrolled for the
                  in-portal compliance page: {portalAccess.detail} The link above works regardless.
                </p>
              </div>
            )}
            {portalAccess?.state === "portal_moved" && (
              <div className="flex items-start gap-2 rounded-md border border-border/60 p-3">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-xs">
                  There is no in-portal compliance page for builder partners on this workspace any
                  more — the portal moved to the Builders Network, and its in-network compliance
                  view arrives with the network connection. The link above is their way in.
                </p>
              </div>
            )}
          </div>
        )}

        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border/50 pt-3">
          {step !== "token" && step !== "ack_sent" && step !== "partner" && (
            <Button variant="ghost" disabled={busy}
              onClick={() => setStep(stepOrder[stepOrder.indexOf(step) - 1])}>
              Back
            </Button>
          )}
          {step === "partner" && (
            <Button disabled={!partnerValid} onClick={() => setStep("link")}>Continue</Button>
          )}
          {step === "link" && (
            <Button disabled={!linkValid} onClick={() => setStep("grant")}>Continue</Button>
          )}
          {step === "grant" && (
            <Button disabled={busy || (!directAck && !readiness.ready)} onClick={completeGrant}>
              {busy && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              {directAck ? "Record & send the agreement" : "Record, invite & grant"}
            </Button>
          )}
          {(step === "token" || step === "ack_sent") && (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
