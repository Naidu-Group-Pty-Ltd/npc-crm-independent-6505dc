import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  KeyRound,
  RefreshCw,
  Activity,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import { fetchTokenBalance } from "@/lib/missionControl";
import {
  settingsCardClass,
  settingsCx,
  settingsDialogClass,
  settingsInputClass,
  settingsPanelClass,
  settingsPillButtonClass,
  settingsPrimaryButtonClass,
  settingsSubtlePanelClass,
} from "@/components/settings/settingsUi";

interface KeyInfo {
  configured: boolean;
  keyPrefix: string | null;
  baseUrl: string | null;
  lastSuccessfulCallAt: string | null;
  lastRotatedAt: string | null;
}

export function MissionControlKeyCard() {
  const { toast } = useToast();
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [testing, setTesting] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [graceHours, setGraceHours] = useState(1);
  const [reason, setReason] = useState("");
  const [rotating, setRotating] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    try {
      const { data, error } = await invokeSecureFunction<KeyInfo>(
        "mission-control-key-info",
        {},
      );
      if (error) {
        const msg = (error.message ?? "").toLowerCase();
        if (msg.includes("forbid")) setForbidden(true);
        else setLoadError(error.message ?? "Failed to load");
        setInfo(null);
        return;
      }
      setInfo(data ?? null);
    } catch (e: any) {
      console.warn("[MissionControlKeyCard] load", e);
      setLoadError(e?.message ?? "Failed to load");
      setInfo(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const testConnection = async () => {
    setTesting(true);
    try {
      const bal = await fetchTokenBalance();
      toast({
        title: "Connection OK",
        description: `Available: ${bal.available.toLocaleString('en-AU')} · Reserved: ${bal.reserved.toLocaleString('en-AU')}`,
      });
      load();
    } catch (e: any) {
      toast({
        title: "Test failed",
        description: e.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  const rotate = async () => {
    setRotating(true);
    try {
      const { data, error } = await invokeSecureFunction<any>(
        "mission-control-rotate-key",
        {
          grace_hours: graceHours,
          reason: reason || "manual_rotation",
        },
      );
      if (error) throw new Error(error.message ?? "Failed");
      const revoke = data?.revokeAt
        ? new Date(data.revokeAt).toLocaleString('en-AU')
        : "soon";
      toast({
        title: "Key rotated",
        description: `New prefix ${data?.keyPrefix ?? "(unknown)"} is live; previous key is revoked at ${revoke}.`,
      });
      setRotateOpen(false);
      setReason("");
      load();
    } catch (e: any) {
      toast({
        title: "Rotation failed",
        description: e.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRotating(false);
    }
  };

  // Hide silently only for non-superadmins (403). Always show otherwise so
  // the card is discoverable even when MC isn't configured yet or the lookup fails.
  if (forbidden) return null;

  return (
    <Card className={settingsCardClass}>
      <CardHeader className="space-y-2">
        <CardTitle className="flex min-w-0 items-center gap-2 text-lg md:text-xl">
          <KeyRound className="h-5 w-5 shrink-0 text-primary" />
          Mission Control Key
        </CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {loading ? (
          <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            Loading…
          </div>
        ) : loadError ? (
          <div className="min-w-0 space-y-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
            <div className="flex min-w-0 items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">
                Couldn't load Mission Control status: {loadError}
              </span>
            </div>
            <Button variant="secondary" size="sm" onClick={load}>
              <RefreshCw className="h-4 w-4 mr-2" /> Retry
            </Button>
          </div>
        ) : (
          <>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Field label="Current key">
                {info?.configured ? (
                  <code className="rounded-full border border-border/60 bg-muted/40 px-2 py-1 text-sm text-foreground">
                    {info?.keyPrefix ?? "(set)"}
                  </code>
                ) : (
                  <Badge variant="destructive" className="gap-1 rounded-full">
                    <AlertTriangle className="h-3 w-3" /> Not configured
                  </Badge>
                )}
              </Field>
              <Field label="Base URL">
                <span className="text-sm text-muted-foreground break-all">
                  {info?.baseUrl ?? "—"}
                </span>
              </Field>
              <Field label="Last successful call">
                <span className="text-sm text-muted-foreground">
                  {info?.lastSuccessfulCallAt
                    ? new Date(info.lastSuccessfulCallAt).toLocaleString('en-AU')
                    : "Never"}
                </span>
              </Field>
              <Field label="Last rotation">
                <span className="text-sm text-muted-foreground">
                  {info?.lastRotatedAt
                    ? new Date(info.lastRotatedAt).toLocaleString('en-AU')
                    : "—"}
                </span>
              </Field>
            </div>

            <div className="flex min-w-0 flex-col gap-2 pt-2 sm:flex-row sm:flex-wrap">
              <Button
                variant="secondary"
                onClick={testConnection}
                disabled={testing || !info?.configured}
                aria-busy={testing}
                className={settingsPillButtonClass}
              >
                {testing ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Activity className="h-4 w-4 mr-2" />
                )}
                Test connection
              </Button>
              <Button
                onClick={() => setRotateOpen(true)}
                disabled={!info?.configured}
                className={settingsCx(
                  settingsPillButtonClass,
                  settingsPrimaryButtonClass,
                )}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Rotate key
              </Button>
            </div>

            <p
              className={settingsCx(
                settingsSubtlePanelClass,
                "flex items-start gap-2",
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">
                The raw secret is never shown — it's written straight into the
                project secrets store. The previous key keeps working during the
                grace period you choose, then Mission Control revokes it
                automatically.
              </span>
            </p>
          </>
        )}
      </CardContent>

      <Dialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <DialogContent
          className={settingsCx(settingsDialogClass, "sm:max-w-lg")}
        >
          <DialogHeader className="space-y-2">
            <DialogTitle>Rotate Mission Control key</DialogTitle>
            <DialogDescription>
              Issues a new clone API key. The previous key remains valid for the
              grace period below, after which Mission Control revokes it
              automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0 space-y-3">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="grace">Grace period (hours)</Label>
              <Input
                id="grace"
                type="number"
                min={0}
                max={168}
                value={graceHours}
                className={settingsInputClass}
                onChange={(e) =>
                  setGraceHours(
                    Math.max(0, Math.min(168, Number(e.target.value) || 0)),
                  )
                }
              />
              <p className="text-xs text-muted-foreground">
                0–168. Default 1 hour.
              </p>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Textarea
                id="reason"
                value={reason}
                maxLength={280}
                className="min-w-0 resize-y break-words focus-visible:ring-primary"
                placeholder="e.g. quarterly rotation, suspected exposure…"
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRotateOpen(false)}
              disabled={rotating}
              className={settingsPillButtonClass}
            >
              Cancel
            </Button>
            <Button
              onClick={rotate}
              disabled={rotating}
              aria-busy={rotating}
              className={settingsCx(
                settingsPillButtonClass,
                settingsPrimaryButtonClass,
              )}
            >
              {rotating && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
              Rotate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={settingsCx(settingsPanelClass, "space-y-2")}>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}
