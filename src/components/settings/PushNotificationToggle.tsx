import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bell, BellOff, AlertTriangle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getPushSupportStatus,
  getCurrentPushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSupportStatus,
} from "@/lib/pushNotifications";
import {
  settingsCardClass,
  settingsCx,
  settingsPanelClass,
  settingsPillButtonClass,
  settingsSwitchClass,
} from "@/components/settings/settingsUi";

export function PushNotificationToggle() {
  const { toast } = useToast();
  const [status, setStatus] = useState<PushSupportStatus>("unsupported");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const refresh = async () => {
    const s = getPushSupportStatus();
    setStatus(s);
    if (s === "granted") {
      const sub = await getCurrentPushSubscription();
      setIsSubscribed(!!sub);
    } else {
      setIsSubscribed(false);
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleToggle = async (next: boolean) => {
    setWorking(true);
    try {
      if (next) {
        const result = await subscribeToPush();
        if (result.success) {
          toast({
            title: "Push notifications enabled",
            description: "You will now receive alerts on this device.",
          });
          await refresh();
        } else {
          toast({
            title: "Could not enable push",
            description: result.reason,
            variant: "destructive",
          });
        }
      } else {
        const result = await unsubscribeFromPush();
        if (result.success) {
          toast({
            title: "Push notifications disabled",
            description:
              "You will no longer receive push alerts on this device.",
          });
          await refresh();
        } else {
          toast({
            title: "Could not disable push",
            description: result.reason,
            variant: "destructive",
          });
        }
      }
    } finally {
      setWorking(false);
    }
  };

  const renderStatusMessage = () => {
    if (status === "unsupported") {
      return (
        <div className="flex min-w-0 items-start gap-2 rounded-2xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>This browser does not support push notifications.</span>
        </div>
      );
    }
    if (status === "preview-blocked") {
      return (
        <div className="flex min-w-0 items-start gap-2 rounded-2xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
          <span>
            Push notifications only work on the published site, not in the
            Lovable editor preview.
          </span>
        </div>
      );
    }
    if (status === "denied") {
      return (
        <div className="flex min-w-0 items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <BellOff className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Notifications are blocked at the browser level. Update site settings
            in your browser to allow notifications.
          </span>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className={settingsCardClass}>
      <CardHeader className="space-y-2">
        <CardTitle className="flex min-w-0 items-center gap-2 text-lg md:text-xl">
          <Bell className="h-4 w-4" />
          Push Notifications
        </CardTitle>
        <CardDescription className="max-w-3xl break-words leading-6">
          Get desktop and mobile alerts for missed calls, reminders, new
          reports, and other dashboard activity — even when the tab is closed.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking notification
            status...
          </div>
        ) : (
          <>
            <div
              className={settingsCx(
                settingsPanelClass,
                "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
              )}
            >
              <Label
                htmlFor="push-toggle"
                className="min-w-0 cursor-pointer break-words leading-5"
              >
                Enable push notifications on this device
              </Label>
              <Switch
                id="push-toggle"
                className={settingsSwitchClass}
                checked={isSubscribed}
                disabled={
                  working || (status !== "granted" && status !== "default")
                }
                onCheckedChange={handleToggle}
              />
            </div>
            {renderStatusMessage()}
            {status === "default" && !isSubscribed && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleToggle(true)}
                disabled={working}
                aria-busy={working}
                className={settingsCx(
                  settingsPillButtonClass,
                  "w-full border-primary/35 shadow-sm hover:border-primary/60 sm:w-auto",
                )}
              >
                {working ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Bell className="h-4 w-4 mr-2" />
                )}
                Allow notifications
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
