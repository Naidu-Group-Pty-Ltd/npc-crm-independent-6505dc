// Shown on the Auth screen when sign-in fails with `device_limit_reached`.
// Lists the user's active devices and lets them revoke one so they can retry
// the sign-in. We intentionally do NOT call `listMyDevices` from here because
// the user is unauthenticated at this point — the device list returned by
// `registerCurrentDevice` is passed in via props.
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Smartphone, Trash2 } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { DeviceRow } from '@/lib/deviceSession';

interface ManageDevicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceLimit: number;
  devicesActive: number;
  devices: DeviceRow[];
  /** Called after the user successfully revokes a device so the caller
   *  can retry the sign-in flow. */
  onDeviceRevoked: () => void;
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'unknown';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return 'unknown';
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function ManageDevicesDialog({
  open,
  onOpenChange,
  deviceLimit,
  devicesActive,
  devices,
  onDeviceRevoked,
}: ManageDevicesDialogProps) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokedIds, setRevokedIds] = useState<Set<string>>(new Set());

  const handleRevoke = async (device: DeviceRow) => {
    setError(null);
    setRevoking(device.id);
    // The user is unauthenticated here, so we call the Mission Control
    // endpoint via a dedicated public action — `release` accepts the
    // device_id without an authenticated caller because it requires a
    // server-known id, not a user mapping.
    const { data, error: err } = await invokeSecureFunction<any>(
      'mission-control-devices',
      { action: 'revoke', device_id: device.id },
    );
    setRevoking(null);
    if (err || !data?.ok) {
      setError(err?.message || data?.error || 'Failed to revoke device. Please try again.');
      return;
    }
    setRevokedIds((s) => new Set(s).add(device.id));
    onDeviceRevoked();
  };

  const visible = devices.filter((d) => !revokedIds.has(d.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Device limit reached</DialogTitle>
          <DialogDescription>
            You're signed in on {devicesActive} of {deviceLimit} devices. Revoke
            one to sign in here.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2 max-h-[320px] overflow-y-auto">
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No active devices left. Try signing in again.
            </p>
          ) : visible.map((device) => (
            <div
              key={device.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                <Smartphone className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {device.device_label || device.platform || 'Browser'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    Last active {formatRelative(device.last_seen_at ?? device.created_at)}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={revoking === device.id}
                onClick={() => handleRevoke(device)}
              >
                {revoking === device.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
