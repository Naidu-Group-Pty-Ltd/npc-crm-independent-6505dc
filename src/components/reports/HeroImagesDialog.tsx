import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import { useToast } from "@/hooks/use-toast";

type AssetStatus = "pending" | "processing" | "ready" | "failed";

interface HeroAsset {
  id: string;
  section_key: string;
  section_title: string;
  status: AssetStatus;
  public_url: string | null;
  include_in_report: boolean;
  error: string | null;
  attempts: number;
}

interface HeroImagesDialogProps {
  reportId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const HERO_PROCESS_BATCH = 3;
const POLL_DELAY_MS = 1500;
const MAX_WAIT_MS = 8 * 60 * 1000;

export function HeroImagesDialog({ reportId, open, onOpenChange }: HeroImagesDialogProps) {
  const [assets, setAssets] = useState<HeroAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [progressText, setProgressText] = useState("");
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await invokeSecureFunction<{ assets: HeroAsset[] }>(
      "prepare-report-hero-images",
      { action: "list", reportId },
      { timeoutMs: 60_000 },
    );
    setLoading(false);
    if (error) {
      toast({
        title: "Couldn't load visuals",
        description: error.message || "Try again shortly.",
        variant: "destructive",
      });
      return;
    }
    setAssets(((data?.assets || []) as HeroAsset[]));
  }, [reportId, toast]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const enqueueAndRun = async (regenerate: boolean) => {
    setGenerating(true);
    try {
      setProgressText("Queuing chapter visuals…");
      const enq = await invokeSecureFunction<{ total: number; pending: number; ready: number }>(
        "prepare-report-hero-images",
        { action: "enqueue", reportId, regenerate },
        { timeoutMs: 60_000 },
      );
      if (enq.error) throw new Error(enq.error.message || "Failed to enqueue");

      const deadline = Date.now() + MAX_WAIT_MS;
      let last = {
        total: enq.data?.total ?? 0,
        ready: enq.data?.ready ?? 0,
        pending: enq.data?.pending ?? 0,
        processing: 0,
        failed: 0,
      } as any;

      while (Date.now() < deadline) {
        const remaining = (last.pending || 0) + (last.processing || 0);
        if (remaining === 0 && last.total > 0) break;
        setProgressText(`Generating visuals · ${last.ready ?? 0}/${last.total ?? 0} ready`);
        const proc = await invokeSecureFunction<any>(
          "prepare-report-hero-images",
          { action: "process", reportId, max: HERO_PROCESS_BATCH },
          { timeoutMs: 180_000 },
        );
        if (proc.error) {
          await sleep(POLL_DELAY_MS);
        } else if (proc.data) {
          last = proc.data;
        }
        if ((last.pending || 0) + (last.processing || 0) === 0) break;
        await sleep(POLL_DELAY_MS);
      }

      await refresh();
      toast({
        title: "Visuals ready",
        description: `${last.ready ?? 0}/${last.total ?? 0} chapter banners generated.`,
      });
    } catch (err: any) {
      toast({
        title: "Generation failed",
        description: err?.message || "Try again.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
      setProgressText("");
    }
  };

  const toggleAsset = async (asset: HeroAsset, next: boolean) => {
    setSavingKey(asset.section_key);
    // optimistic
    setAssets((prev) =>
      prev.map((a) => (a.section_key === asset.section_key ? { ...a, include_in_report: next } : a)),
    );
    const { error } = await invokeSecureFunction(
      "prepare-report-hero-images",
      { action: "set_selection", reportId, sectionKey: asset.section_key, include: next },
      { timeoutMs: 30_000 },
    );
    setSavingKey(null);
    if (error) {
      // revert
      setAssets((prev) =>
        prev.map((a) => (a.section_key === asset.section_key ? { ...a, include_in_report: !next } : a)),
      );
      toast({
        title: "Couldn't update selection",
        description: error.message || "Try again.",
        variant: "destructive",
      });
    }
  };

  const setAll = async (include: boolean) => {
    const targets = assets.filter((a) => a.status === "ready");
    if (targets.length === 0) return;
    setAssets((prev) => prev.map((a) => (a.status === "ready" ? { ...a, include_in_report: include } : a)));
    await invokeSecureFunction(
      "prepare-report-hero-images",
      {
        action: "set_selection",
        reportId,
        selections: targets.map((a) => ({ sectionKey: a.section_key, include })),
      },
      { timeoutMs: 60_000 },
    );
  };

  const regenerateOne = async (asset: HeroAsset) => {
    setSavingKey(asset.section_key);
    await invokeSecureFunction(
      "prepare-report-hero-images",
      { action: "regenerate_one", reportId, sectionKey: asset.section_key },
      { timeoutMs: 30_000 },
    );
    setSavingKey(null);
    await enqueueAndRun(false);
  };

  const readyCount = assets.filter((a) => a.status === "ready").length;
  const selectedCount = assets.filter((a) => a.status === "ready" && a.include_in_report).length;
  const pendingCount = assets.filter((a) => a.status === "pending" || a.status === "processing").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            Manage Hero Images
          </DialogTitle>
          <DialogDescription>
            Generate, preview, and choose which chapter banners are embedded in the premium PDF.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-3 border-b flex flex-wrap items-center gap-2 bg-muted/30">
          <Badge variant="secondary">{assets.length} chapters</Badge>
          <Badge variant="outline" className="border-success/40 text-success">
            {readyCount} ready
          </Badge>
          {pendingCount > 0 && (
            <Badge variant="outline" className="border-brand-500/40 text-brand-500">
              {pendingCount} pending
            </Badge>
          )}
          <Badge variant="default">
            {selectedCount} selected for PDF
          </Badge>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAll(true)} disabled={!readyCount}>
              Select all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAll(false)} disabled={!readyCount}>
              Deselect all
            </Button>
            <Button size="sm" variant="outline" onClick={() => refresh()} disabled={loading || generating}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => enqueueAndRun(false)}
              disabled={generating}
              className="bg-gradient-to-r from-primary to-primary/70"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-1" />
              )}
              {generating ? progressText || "Generating…" : assets.length === 0 ? "Generate visuals" : "Generate missing"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => enqueueAndRun(true)}
              disabled={generating}
              title="Wipe and regenerate every chapter banner"
            >
              Regenerate all
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1 px-6 py-4">
          {assets.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center text-center py-16 gap-3 text-muted-foreground">
              <ImageIcon className="h-10 w-10 opacity-40" />
              <p className="text-sm">No chapter visuals have been generated for this report yet.</p>
              <Button size="sm" onClick={() => enqueueAndRun(false)} disabled={generating}>
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                Generate visuals
              </Button>
            </div>
          )}
          {loading && assets.length === 0 && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className={`border rounded-lg overflow-hidden bg-card transition-opacity ${
                  asset.status === "ready" && !asset.include_in_report ? "opacity-50" : ""
                }`}
              >
                <div className="relative aspect-[3/1] bg-muted">
                  {asset.public_url ? (
                    <img
                      src={asset.public_url}
                      alt={asset.section_title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      {asset.status === "failed" ? (
                        <AlertCircle className="h-6 w-6 text-destructive" />
                      ) : (
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  )}
                  <div className="absolute top-2 left-2">
                    {asset.status === "ready" && (
                      <Badge className="bg-success/90 text-success-foreground">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Ready
                      </Badge>
                    )}
                    {asset.status === "pending" && <Badge variant="secondary">Pending</Badge>}
                    {asset.status === "processing" && <Badge variant="secondary">Generating…</Badge>}
                    {asset.status === "failed" && (
                      <Badge variant="destructive">Failed</Badge>
                    )}
                  </div>
                </div>
                <div className="p-3 flex items-start gap-3">
                  <Checkbox
                    checked={asset.include_in_report}
                    disabled={asset.status !== "ready" || savingKey === asset.section_key}
                    onCheckedChange={(v) => toggleAsset(asset, v === true)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight truncate" title={asset.section_title}>
                      {asset.section_title}
                    </p>
                    {asset.error && (
                      <p className="text-xs text-destructive mt-1 line-clamp-2">{asset.error}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => regenerateOne(asset)}
                    disabled={generating || savingKey === asset.section_key}
                    title="Regenerate this image"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
