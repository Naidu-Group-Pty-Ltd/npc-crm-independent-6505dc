import { useEffect, useState } from "react";
import { FileWarning, ThumbsUp, ThumbsDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { amlRiskApi, type AmlRiskOverride, type AmlApproval } from "@/lib/aml/amlRiskApi";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import { RegulatoryAssuranceHeader } from "@/components/aml/RegulatoryAssuranceHeader";
import {
  AmlEmptyState,
  AmlLoadingState,
  AmlPageHeader,
  AmlRefreshButton,
} from "@/components/aml/primitives";

const STATUS_TONE: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
};

export default function AmlInvestigations() {
  const { roles } = useAmlAccess();
  const canReview = roles.has("reviewer") || roles.has("mlro");
  const { regulatoryHub } = useAmlV3Flags();
  const [tab, setTab] = useState("overrides");
  const [overrides, setOverrides] = useState<AmlRiskOverride[]>([]);
  const [approvals, setApprovals] = useState<AmlApproval[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [o, a] = await Promise.all([
        amlRiskApi.listOverrides({}),
        amlRiskApi.listApprovals({}),
      ]);
      setOverrides(o.overrides); setApprovals(a.approvals);
    } catch (e: any) { toast.error(e?.message ?? "Failed to load"); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function resolveOv(id: string, status: "approved" | "rejected") {
    try { await amlRiskApi.resolveOverride(id, status); refresh(); toast.success(`Override ${status}`); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }
  async function resolveAp(id: string, status: "approved" | "rejected") {
    try { await amlRiskApi.resolveApproval(id, status); refresh(); toast.success(`Approval ${status}`); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  return (
    <div className="space-y-6">
      {regulatoryHub && <RegulatoryAssuranceHeader />}
      <AmlPageHeader
        title="Investigations & EDD"
        description="Review and decide risk override requests and senior-authority approvals raised from case decisions."
        icon={FileWarning}
        actions={<AmlRefreshButton onClick={refresh} loading={loading} />}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overrides">Overrides ({overrides.filter((o) => o.status === "pending").length})</TabsTrigger>
          <TabsTrigger value="approvals">Approvals ({approvals.filter((a) => a.status === "pending").length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overrides">
          <Card>
            <CardContent className="pt-6">
              {loading ? <AmlLoadingState variant="list" lines={3} label="Loading override requests…" /> : overrides.length === 0 ? (
                <AmlEmptyState body="No override requests. Overrides raised from case decisions appear here for approval." />
              ) : (
                <Table aria-label="Risk override requests">
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Requested</TableHead>
                      <TableHead scope="col">Case</TableHead>
                      <TableHead scope="col">Requested rating</TableHead>
                      <TableHead scope="col">Reason</TableHead>
                      <TableHead scope="col">Status</TableHead>
                      <TableHead scope="col" className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overrides.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="text-xs">{new Date(o.created_at).toLocaleString('en-AU')}</TableCell>
                        <TableCell className="font-mono text-xs">{o.case_id.slice(0, 8)}…</TableCell>
                        <TableCell>{o.requested_rating || "—"}</TableCell>
                        <TableCell className="max-w-md text-sm text-muted-foreground">{o.requested_reason}</TableCell>
                        <TableCell><Badge className={STATUS_TONE[o.status]}>{o.status}</Badge></TableCell>
                        <TableCell className="text-right">
                          {o.status === "pending" && canReview && (
                            <>
                              <Button size="sm" variant="ghost" aria-label="Approve override request" onClick={() => resolveOv(o.id, "approved")}><ThumbsUp aria-hidden="true" className="h-4 w-4" /></Button>
                              <Button size="sm" variant="ghost" aria-label="Reject override request" onClick={() => resolveOv(o.id, "rejected")}><ThumbsDown aria-hidden="true" className="h-4 w-4" /></Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approvals">
          <Card>
            <CardContent className="pt-6">
              {loading ? <AmlLoadingState variant="list" lines={3} label="Loading approval requests…" /> : approvals.length === 0 ? (
                <AmlEmptyState body="No approval requests. Senior-authority approvals raised from case workflows appear here for decision." />
              ) : (
                <Table aria-label="Senior-authority approval requests">
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Requested</TableHead>
                      <TableHead scope="col">Case</TableHead>
                      <TableHead scope="col">Kind</TableHead>
                      <TableHead scope="col">Status</TableHead>
                      <TableHead scope="col">Note</TableHead>
                      <TableHead scope="col" className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {approvals.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs">{new Date(a.requested_at).toLocaleString('en-AU')}</TableCell>
                        <TableCell className="font-mono text-xs">{a.case_id.slice(0, 8)}…</TableCell>
                        <TableCell>{a.kind}</TableCell>
                        <TableCell><Badge className={STATUS_TONE[a.status]}>{a.status}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{a.note || "—"}</TableCell>
                        <TableCell className="text-right">
                          {a.status === "pending" && canReview && (
                            <>
                              <Button size="sm" variant="ghost" aria-label="Approve request" onClick={() => resolveAp(a.id, "approved")}><ThumbsUp aria-hidden="true" className="h-4 w-4" /></Button>
                              <Button size="sm" variant="ghost" aria-label="Reject request" onClick={() => resolveAp(a.id, "rejected")}><ThumbsDown aria-hidden="true" className="h-4 w-4" /></Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
