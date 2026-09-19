/**
 * AML V3 Phase 9 · Directive 14 — Compliance Leadership Contacts.
 *
 * Additive panel exposed inside Governance & Contacts when the
 * `aml_v3_org_settings` flag is on. Persists to
 * `aml.tenant_settings.metadata.aml_governance_contacts` via the same
 * pattern as the activation program — no schema change.
 *
 * Contact roles (fixed):
 *   compliance_officer · mlro · senior_approver · backup_officer · austrac_administrator
 *
 * Notes:
 *   - MLRO is authoritative for AUSTRAC signoff banners; other roles are
 *     informational and appear on internal escalation surfaces only.
 *   - Read-only for non-MLRO users. Server-side capability check is
 *     already enforced by `update_tenant_settings`.
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Save, Lock, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  amlTenantApi,
  type AmlGovernanceContact,
  type AmlGovernanceContactRole,
  type AmlGovernanceContacts,
} from "@/lib/aml/amlTenantApi";
import { useAmlAccess } from "@/hooks/useAmlAccess";

const ROLES: { key: AmlGovernanceContactRole; label: string; required: boolean; hint: string }[] = [
  { key: "mlro", label: "MLRO / Reporting Officer", required: true,
    hint: "Signs AUSTRAC submissions and receives escalation notices." },
  { key: "compliance_officer", label: "AML/CTF Compliance Officer", required: true,
    hint: "Owns the tenant’s AML/CTF program and day-to-day compliance." },
  { key: "senior_approver", label: "Senior Approver", required: false,
    hint: "Approves EDD outcomes and Model B service-entitlement releases." },
  { key: "backup_officer", label: "Backup Compliance Officer", required: false,
    hint: "Deputy for the AML/CTF officer during leave or handover." },
  { key: "austrac_administrator", label: "AUSTRAC Administrator", required: false,
    hint: "Manages AUSTRAC Online tenant credentials and reporting entities." },
];

const EMPTY_CONTACT: AmlGovernanceContact = { name: "", email: "", phone: "", title: "", notes: "" };
const EMPTY: AmlGovernanceContacts = {
  compliance_officer: { ...EMPTY_CONTACT },
  mlro: { ...EMPTY_CONTACT },
  senior_approver: { ...EMPTY_CONTACT },
  backup_officer: { ...EMPTY_CONTACT },
  austrac_administrator: { ...EMPTY_CONTACT },
};

function isValidEmail(v: string): boolean {
  if (!v) return true; // optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function GovernanceContactsPanel() {
  const { isMlro } = useAmlAccess();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contacts, setContacts] = useState<AmlGovernanceContacts>(EMPTY);
  const [dirty, setDirty] = useState<Set<AmlGovernanceContactRole>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await amlTenantApi.getGovernanceContacts();
        if (!cancelled) setContacts(c);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message ?? "Failed to load contacts");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const emailErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    for (const r of ROLES) {
      const email = contacts[r.key]?.email ?? "";
      if (!isValidEmail(email)) errs[r.key] = "Invalid email address";
    }
    return errs;
  }, [contacts]);

  const missingRequired = useMemo(
    () => ROLES.filter((r) => r.required && !contacts[r.key]?.name?.trim()).map((r) => r.label),
    [contacts],
  );

  const update = (role: AmlGovernanceContactRole, patch: Partial<AmlGovernanceContact>) => {
    setContacts((prev) => ({ ...prev, [role]: { ...prev[role], ...patch } }));
    setDirty((d) => new Set(d).add(role));
  };

  const save = async () => {
    if (Object.keys(emailErrors).length > 0) {
      toast.error("Fix invalid emails before saving");
      return;
    }
    setSaving(true);
    try {
      await amlTenantApi.updateGovernanceContacts(contacts);
      setDirty(new Set());
      toast.success("Compliance leadership contacts saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> Compliance Leadership Contacts
          </h2>
          <p className="text-xs text-muted-foreground">
            The tenant’s AML/CTF officers of record. MLRO details appear on
            AUSTRAC signoff blocks and internal escalation banners.
          </p>
        </div>
        {!isMlro && (
          <Alert className="max-w-sm">
            <Lock className="h-4 w-4" />
            <AlertTitle>Read-only</AlertTitle>
            <AlertDescription>Only the MLRO can update contacts.</AlertDescription>
          </Alert>
        )}
      </div>

      {missingRequired.length > 0 && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Required contact missing</AlertTitle>
          <AlertDescription>
            Please provide a name for: {missingRequired.join(", ")}.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {ROLES.map((role) => {
          const c = contacts[role.key];
          const isDirty = dirty.has(role.key);
          const emailErr = emailErrors[role.key];
          return (
            <Card key={role.key} className="border-border/60">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">
                    {role.label}
                    {role.required && (
                      <Badge variant="outline" className="ml-2 border-primary/40 text-primary text-[10px]">
                        Required
                      </Badge>
                    )}
                  </CardTitle>
                  {isDirty && (
                    <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">
                      Unsaved
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-xs">{role.hint}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] uppercase text-muted-foreground">Name</Label>
                    <Input
                      value={c.name}
                      disabled={!isMlro}
                      onChange={(e) => update(role.key, { name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] uppercase text-muted-foreground">Title</Label>
                    <Input
                      value={c.title}
                      disabled={!isMlro}
                      onChange={(e) => update(role.key, { title: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] uppercase text-muted-foreground">Email</Label>
                    <Input
                      type="email"
                      value={c.email}
                      disabled={!isMlro}
                      onChange={(e) => update(role.key, { email: e.target.value })}
                      className={emailErr ? "border-destructive/60" : ""}
                    />
                    {emailErr && <div className="text-[10px] text-destructive">{emailErr}</div>}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] uppercase text-muted-foreground">Phone</Label>
                    <Input
                      value={c.phone}
                      disabled={!isMlro}
                      onChange={(e) => update(role.key, { phone: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] uppercase text-muted-foreground">Notes</Label>
                  <Input
                    value={c.notes}
                    disabled={!isMlro}
                    placeholder="Delegation window, escalation preference, etc."
                    onChange={(e) => update(role.key, { notes: e.target.value })}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button
          onClick={save}
          disabled={!isMlro || saving || dirty.size === 0 || Object.keys(emailErrors).length > 0}
        >
          <Save className="h-4 w-4 mr-1.5" />
          {saving ? "Saving…" : "Save contacts"}
        </Button>
      </div>
    </div>
  );
}
