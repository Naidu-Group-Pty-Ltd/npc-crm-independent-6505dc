/**
 * Party ↔ canonical verification evidence links.
 *
 * A party's verification state is DERIVED from linked authoritative canonical
 * checks — this panel never sets a verified flag directly, and a simulated or
 * non-authoritative check cannot be linked at all (the server refuses it).
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Link2, Unlink } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { amlCasesApi, type AmlPartyVerificationLink } from "@/lib/aml/amlCasesApi";
import { displayDate } from "@/lib/aml/displayDate";

/**
 * Exactly `aml.party_verification_links_party_type_check`.
 *
 * This list used to carry "beneficiary", which that CHECK does not allow: a
 * staff member who picked it got a constraint error from the server instead of
 * a link. Found by the production-shaped database rehearsal. Keep this in step
 * with the migration — the database is the authority, not the picker.
 */
const PARTY_TYPES = [
  "case_subject", "co_purchaser", "director", "trustee", "beneficial_owner",
  "authorised_representative", "donor", "private_lender", "other",
];

export function PartyVerificationPanel({
  caseId, canWrite, onChanged,
}: { caseId: string; canWrite: boolean; onChanged: () => void }) {
  const [links, setLinks] = useState<AmlPartyVerificationLink[] | null>(null);
  const [checks, setChecks] = useState<any[]>([]);
  const [partyType, setPartyType] = useState("case_subject");
  const [partyId, setPartyId] = useState("");
  const [checkId, setCheckId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await amlCasesApi.listPartyVerificationLinks(caseId);
      setLinks(r.links); setChecks(r.eligible_checks ?? []);
    } catch (e: any) {
      setLinks([]);
      toast({ title: "Could not load verification links", description: e?.message, variant: "destructive" });
    }
  }, [caseId]);
  useEffect(() => { void load(); }, [load]);

  const link = async () => {
    if (!checkId) { toast({ title: "Select a canonical verification check", variant: "destructive" }); return; }
    setBusy(true);
    try {
      await amlCasesApi.linkPartyVerification({
        case_id: caseId, party_type: partyType,
        party_id: partyId.trim() || undefined, verification_check_id: checkId,
      });
      toast({ title: "Evidence linked" });
      setCheckId(""); setPartyId("");
      await load(); onChanged();
    } catch (e: any) {
      toast({ title: "Link failed", description: e?.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const unlink = async (id: string) => {
    const reason = window.prompt("Reason for unlinking this evidence (recorded on the case):");
    if (!reason || reason.trim().length < 5) {
      toast({ title: "An unlink reason of at least 5 characters is required", variant: "destructive" });
      return;
    }
    try {
      await amlCasesApi.unlinkPartyVerification(id, reason.trim());
      toast({ title: "Evidence unlinked" });
      await load(); onChanged();
    } catch (e: any) {
      toast({ title: "Unlink failed", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Party verification evidence</CardTitle>
        <CardDescription>
          Each applicable party's verification state is derived from the canonical check linked here. Simulated and
          non-authoritative checks cannot be used as evidence.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {links === null ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading links" />
        ) : links.length === 0 ? (
          <p className="text-sm text-muted-foreground">No verification evidence linked to a party yet.</p>
        ) : (
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{l.party_type.replace(/_/g, " ")}</div>
                  <div className="text-xs text-muted-foreground">
                    {l.relationship.replace(/_/g, " ")} · linked {displayDate(l.linked_at)}
                    {l.metadata?.linked_status ? <> · {String(l.metadata.linked_status)}</> : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={l.authoritative ? "default" : "secondary"}>
                    {l.authoritative ? "authoritative" : "non-authoritative"}
                  </Badge>
                  {canWrite && (
                    <Button size="sm" variant="ghost" onClick={() => void unlink(l.id)} aria-label="Unlink evidence">
                      <Unlink className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* One column by default: this panel lives in the workspace's narrow
            middle column, so a viewport-keyed 4-up grid gave every control ~55px
            and clipped the labels, the party-type value and the button text at
            every viewport — including 1728px. Two-up only once the panel itself
            is wide, with the action on its own full-width row. */}
        {canWrite && (
          <div className="grid gap-2 rounded-md border border-border/60 bg-muted/20 p-3 lg:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="pv-type" className="text-xs">Party type</Label>
              <Select value={partyType} onValueChange={setPartyType}>
                <SelectTrigger id="pv-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PARTY_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pv-party" className="text-xs">Canonical party id (optional)</Label>
              <Input id="pv-party" value={partyId} onChange={(e) => setPartyId(e.target.value)} placeholder="Owners and representatives only" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pv-check" className="text-xs">Canonical check</Label>
              <Select value={checkId} onValueChange={setCheckId}>
                <SelectTrigger id="pv-check"><SelectValue placeholder="Select evidence" /></SelectTrigger>
                <SelectContent>
                  {checks.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {(c.party_label ?? "subject")} · {c.check_type?.replace(/_/g, " ")} · {c.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end lg:col-span-2">
              <Button size="sm" onClick={() => void link()} disabled={busy} className="w-full">
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1.5 h-3.5 w-3.5" />}
                Link evidence
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
