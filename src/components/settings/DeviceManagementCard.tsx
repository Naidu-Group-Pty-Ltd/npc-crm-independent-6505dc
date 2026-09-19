/**
 * Device Management — lists the active devices counting toward the user's
 * Mission Control device cap and lets them revoke any of them. The current
 * browser is highlighted using the locally-stored device id.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  RefreshCw,
  Smartphone,
  Trash2,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import {
  listMyDevices,
  revokeDevice,
  type DeviceRow,
} from "@/lib/deviceSession";
import { getStoredDeviceId } from "@/lib/deviceFingerprint";
import { useToast } from "@/hooks/use-toast";
import {
  settingsBadgePillClass,
  settingsCardClass,
  settingsDangerButtonClass,
  settingsInteractiveRowClass,
  settingsPillButtonClass,
  settingsSubtlePanelClass,
  settingsCx,
} from "@/components/settings/settingsUi";

function formatRelative(iso: string | null): string {
  if (!iso) return "unknown";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "unknown";
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function DeviceManagementCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [deviceLimit, setDeviceLimit] = useState(0);
  const [devicesActive, setDevicesActive] = useState(0);
  const [revoking, setRevoking] = useState<string | null>(null);
  const currentId = getStoredDeviceId();

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await listMyDevices();
      setDevices(res.devices);
      setDeviceLimit(res.device_limit);
      setDevicesActive(res.devices_active);
    } catch (e: any) {
      setError(e?.message || "Failed to load devices.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = async (device: DeviceRow) => {
    if (device.id === currentId) {
      toast({
        title: "Sign out instead",
        description:
          "Revoke the current device by signing out from this browser.",
        variant: "destructive",
      });
      return;
    }
    setRevoking(device.id);
    const { ok, error: err } = await revokeDevice(device.id);
    setRevoking(null);
    if (!ok) {
      toast({
        title: "Could not revoke",
        description: err || "Try again.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Device revoked",
      description: device.device_label || "Device removed.",
    });
    void load(true);
  };

  return (
    <Card className={settingsCardClass}>
      <CardHeader className="space-y-4">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <CardTitle className="flex min-w-0 items-center gap-2 text-lg md:text-xl">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
              Active devices
            </CardTitle>
            <CardDescription className="max-w-3xl break-words leading-6">
              Browsers and devices currently signed in to your account.
              {deviceLimit > 0 && (
                <>
                  {" "}
                  Using <strong>{devicesActive}</strong> of{" "}
                  <strong>{deviceLimit}</strong> slots.
                </>
              )}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => load(true)}
            disabled={loading || refreshing}
            aria-label="Refresh active devices"
            aria-busy={refreshing}
            className={settingsCx(settingsPillButtonClass, "w-full sm:w-auto")}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-3">
        {error && (
          <Alert
            variant="destructive"
            className="min-w-0 overflow-hidden rounded-2xl"
          >
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="break-words">{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : devices.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-muted/25 px-4 py-8 text-center text-sm italic text-muted-foreground">
            <Smartphone className="mx-auto mb-3 h-10 w-10 opacity-50" />
            No active devices found.
          </div>
        ) : (
          devices.map((device) => {
            const isCurrent = device.id === currentId;
            return (
              <div
                key={device.id}
                className={settingsCx(
                  settingsInteractiveRowClass,
                  "flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/45 p-3 shadow-sm dark:border-white/10 dark:bg-background/35 sm:flex-row sm:items-center sm:justify-between",
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
                    <Smartphone className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="min-w-0 break-words text-sm font-medium">
                        {device.device_label || device.platform || "Browser"}
                      </p>
                      {isCurrent && (
                        <Badge
                          variant="secondary"
                          className={settingsCx(
                            settingsBadgePillClass,
                            "bg-primary/10 text-[10px] text-primary",
                          )}
                        >
                          This device
                        </Badge>
                      )}
                    </div>
                    <p className="min-w-0 break-words text-xs leading-5 text-muted-foreground">
                      Last active{" "}
                      {formatRelative(device.last_seen_at ?? device.created_at)}
                      {device.user_agent
                        ? ` · ${device.user_agent.slice(0, 60)}`
                        : ""}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revoking === device.id || isCurrent}
                  onClick={() => handleRevoke(device)}
                  title={
                    isCurrent
                      ? "Sign out to revoke this device"
                      : "Revoke device"
                  }
                  aria-label={
                    isCurrent
                      ? "Current device cannot be revoked here"
                      : `Revoke ${device.device_label || device.platform || "device"}`
                  }
                  className={settingsDangerButtonClass}
                >
                  {revoking === device.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            );
          })
        )}

        <Separator />
        <p className={settingsSubtlePanelClass}>
          Revoking a device signs that browser out immediately and frees a
          device slot.
        </p>
      </CardContent>
    </Card>
  );
}
