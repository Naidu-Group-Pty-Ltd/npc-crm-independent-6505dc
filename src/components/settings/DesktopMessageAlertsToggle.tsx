/**
 * Settings control for internal-message desktop alerts.
 *
 * The in-app invitation is offered once, in context. This card is the durable
 * way in and out: it shows the real browser permission state, requests it from
 * a genuine user gesture, separates the audible ping from the visual alert, and
 * can fire a sample so staff can confirm alerts really reach their desktop.
 */
import { useCallback, useEffect, useState } from "react";
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
import {
  AlertTriangle,
  BellOff,
  BellRing,
  Info,
  Loader2,
  MessageSquare,
  Volume2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getDesktopAlertDiagnostics,
  markPromptedDesktopAlerts,
  playMessagePing,
  requestDesktopAlertPermission,
  sendTestDesktopAlert,
  setDesktopAlertsEnabled,
  setMessageSoundEnabled,
  type DesktopAlertDiagnostics,
} from "@/lib/desktopMessageAlerts";
import {
  settingsCardClass,
  settingsCx,
  settingsPanelClass,
  settingsPillButtonClass,
  settingsSubtlePanelClass,
  settingsSwitchClass,
} from "@/components/settings/settingsUi";

export function DesktopMessageAlertsToggle() {
  const { toast } = useToast();
  const [diagnostics, setDiagnostics] = useState<DesktopAlertDiagnostics | null>(
    null,
  );
  const [working, setWorking] = useState(false);

  const refresh = useCallback(() => {
    setDiagnostics(getDesktopAlertDiagnostics());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const status = diagnostics?.status ?? "unsupported";
  const alertsOn = diagnostics?.enabled ?? true;
  const soundOn = diagnostics?.soundEnabled ?? true;

  const handleAllow = async () => {
    setWorking(true);
    try {
      markPromptedDesktopAlerts();
      const result = await requestDesktopAlertPermission();
      refresh();
      if (result === "granted") {
        toast({
          title: "Desktop alerts enabled",
          description:
            "New team messages will reach your desktop while the dashboard is in another tab, page or module.",
        });
      } else if (result === "denied") {
        toast({
          title: "Notifications blocked",
          description:
            "Your browser is blocking notifications for this site. Allow them from the padlock icon in the address bar, then try again.",
          variant: "destructive",
        });
      }
    } finally {
      setWorking(false);
    }
  };

  const handleAlertsToggle = (next: boolean) => {
    setDesktopAlertsEnabled(next);
    refresh();
    toast({
      title: next ? "Desktop alerts on" : "Desktop alerts off",
      description: next
        ? "You will be notified on your desktop when a team message arrives."
        : "Messages will still appear in the dashboard with an unread badge — only the desktop notification is switched off.",
    });
  };

  const handleSoundToggle = (next: boolean) => {
    setMessageSoundEnabled(next);
    refresh();
    if (next) playMessagePing();
  };

  const handleTest = async () => {
    setWorking(true);
    try {
      const outcome = await sendTestDesktopAlert();
      if (outcome === "shown") {
        if (soundOn) playMessagePing();
        toast({
          title: "Test alert sent",
          description:
            "If nothing appeared, check your operating system's notification settings for this browser (Focus / Do Not Disturb will hold it back).",
        });
      } else {
        toast({
          title: "Could not send the test alert",
          description:
            "Allow notifications for this site first, then try again.",
          variant: "destructive",
        });
      }
    } finally {
      setWorking(false);
    }
  };

  const renderStatusMessage = () => {
    if (status === "unsupported") {
      return (
        <div className="flex min-w-0 items-start gap-2 rounded-2xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This browser does not support desktop notifications. Messages still
            arrive in the dashboard with an unread badge on the tab.
          </span>
        </div>
      );
    }
    if (status === "denied") {
      return (
        <div className="flex min-w-0 items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <BellOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Notifications are blocked at the browser level. Allow them from the
            padlock icon in the address bar to receive desktop alerts. Until
            then, unread messages are still flagged on the tab title, the
            favicon and the message dock.
          </span>
        </div>
      );
    }
    if (status === "default") {
      return (
        <div className="flex min-w-0 items-start gap-2 rounded-2xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            Your browser has not been asked yet. Allow notifications to get
            alerts while the dashboard is in the background.
          </span>
        </div>
      );
    }
    if (diagnostics?.serviceWorkerBlocked) {
      return (
        <div className={settingsSubtlePanelClass}>
          Alerts are delivered by this tab. On the published site they are handed
          to the background service worker instead, so they survive the tab being
          suspended.
        </div>
      );
    }
    return null;
  };

  return (
    <Card className={settingsCardClass}>
      <CardHeader className="space-y-2">
        <CardTitle className="flex min-w-0 items-center gap-2 text-lg md:text-xl">
          <MessageSquare className="h-4 w-4" />
          Team Message Alerts
        </CardTitle>
        <CardDescription className="max-w-3xl break-words leading-6">
          Get a desktop notification the moment a colleague messages you —
          showing who sent it and a short preview — while you are working in
          another tab, page or module. Clicking it takes you straight to the
          conversation.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {!diagnostics ? (
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
                htmlFor="desktop-message-alerts"
                className="min-w-0 cursor-pointer break-words leading-5"
              >
                Desktop alerts for new team messages
              </Label>
              <Switch
                id="desktop-message-alerts"
                className={settingsSwitchClass}
                checked={alertsOn && status === "granted"}
                disabled={working || status !== "granted"}
                onCheckedChange={handleAlertsToggle}
              />
            </div>

            <div
              className={settingsCx(
                settingsPanelClass,
                "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
              )}
            >
              <Label
                htmlFor="message-alert-sound"
                className="flex min-w-0 cursor-pointer items-center gap-2 break-words leading-5"
              >
                <Volume2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                Play a sound when a message arrives
              </Label>
              <Switch
                id="message-alert-sound"
                className={settingsSwitchClass}
                checked={soundOn}
                disabled={working}
                onCheckedChange={handleSoundToggle}
              />
            </div>

            {renderStatusMessage()}

            <div className="flex flex-col gap-2 sm:flex-row">
              {status === "default" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAllow}
                  disabled={working}
                  aria-busy={working}
                  className={settingsCx(
                    settingsPillButtonClass,
                    "w-full border-primary/35 shadow-sm hover:border-primary/60 sm:w-auto",
                  )}
                >
                  {working ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <BellRing className="mr-2 h-4 w-4" />
                  )}
                  Allow notifications
                </Button>
              )}
              {status === "granted" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleTest}
                  disabled={working || !alertsOn}
                  aria-busy={working}
                  className={settingsCx(
                    settingsPillButtonClass,
                    "w-full sm:w-auto",
                  )}
                >
                  {working ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <BellRing className="mr-2 h-4 w-4" />
                  )}
                  Send a test alert
                </Button>
              )}
            </div>

            <p className={settingsSubtlePanelClass}>
              Alerts are per-device and never duplicated: with the dashboard open
              in several tabs you are notified once per message. With desktop
              alerts off, unread messages are still shown on the tab title, the
              favicon and the floating message dock.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
