import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useModulePermissions } from "@/hooks/useModulePermissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  RefreshCw,
  Shield,
  Palette,
  Clock,
  Mail,
  FileSignature,
  Zap,
  Settings as SettingsIcon,
  CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWhiteLabel } from "@/contexts/WhiteLabelContext";
import { ComparisonScoreMigration } from "@/components/admin/ComparisonScoreMigration";
import { isClientFacingDeployment } from "@/lib/clientFacing";
import { ProfileCredentials } from "@/components/settings/ProfileCredentials";
import { FinanceAgentContacts } from "@/components/settings/FinanceAgentContacts";
import { PushNotificationToggle } from "@/components/settings/PushNotificationToggle";
import { DesktopMessageAlertsToggle } from "@/components/settings/DesktopMessageAlertsToggle";
import { MissionControlKeyCard } from "@/components/settings/MissionControlKeyCard";
import { BuilderStockMarketplaceCard } from "@/components/settings/BuilderStockMarketplaceCard";
import { SeatEntitlementCard } from "@/components/settings/SeatEntitlementCard";
import { PricingCatalogCard } from "@/components/settings/PricingCatalogCard";
import { EntitlementDiagnosticsCard } from "@/components/settings/EntitlementDiagnosticsCard";
import { PurchaseHistoryCard } from "@/components/settings/PurchaseHistoryCard";
import { DeviceManagementCard } from "@/components/settings/DeviceManagementCard";
import { TotpEnrollmentCard } from "@/components/settings/TotpEnrollmentCard";
import { RecoveryCodeCard } from "@/components/settings/RecoveryCodeCard";
import { WebAuthnSettings } from "@/components/settings/WebAuthnSettings";
import { useAuth } from "@/hooks/useAuth";
import { logActivityDirect } from "@/hooks/useActivityLogger";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import { DashboardThemeFrame } from "@/components/layout/DashboardThemeFrame";
import {
  settingsAccentCardClass,
  settingsBadgePillClass,
  settingsCardClass,
  settingsCx,
  settingsInputClass,
  settingsPanelClass,
  settingsPillButtonClass,
  settingsPrimaryButtonClass,
  settingsSwitchClass,
} from "@/components/settings/settingsUi";

export default function Settings() {
  const { canEdit: canEditSettings } = useModulePermissions("settings");
  const { user } = useAuth();
  const [settings, setSettings] = useState({
    timezone: "Australia/Sydney",
    bookingTimezone: "Australia/Sydney",
    notifications: true,
    autoRefresh: true,
    refreshInterval: 5,
    autoContinueReports: true,
    autoContinueMaxRetries: 3,
    autoContinueDelaySeconds: 15,
  });
  const [isSaving, setIsSaving] = useState(false);

  // Mailbox settings
  const [personalMailbox, setPersonalMailbox] = useState("");
  const [loadingMailbox, setLoadingMailbox] = useState(true);
  const [savingMailbox, setSavingMailbox] = useState(false);

  // Email signature settings
  const [emailSignature, setEmailSignature] = useState("");
  const [loadingSignature, setLoadingSignature] = useState(true);
  const [savingSignature, setSavingSignature] = useState(false);

  const { toast } = useToast();
  const { themeMode, setThemeMode } = useWhiteLabel();

  // Load settings from localStorage on component mount
  useEffect(() => {
    const savedSettings = localStorage.getItem("dashboard-settings");
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setSettings((prev) => ({ ...prev, ...parsed }));
      } catch (error) {
        console.error("Failed to parse saved settings:", error);
      }
    }

    // Fetch user's mailbox
    fetchOwnProfile();
  }, []);

  const fetchOwnProfile = async () => {
    try {
      const { data } = await invokeSecureFunction("admin-user-management", {
        action: "get_own_profile",
      });

      if (data?.success && data.user) {
        setPersonalMailbox(data.user.personal_mailbox || "");
        setEmailSignature(data.user.email_signature || "");
      }
    } catch (err) {
      console.error("Failed to fetch profile:", err);
    } finally {
      setLoadingMailbox(false);
      setLoadingSignature(false);
    }
  };

  const handleSaveMailbox = async () => {
    setSavingMailbox(true);
    try {
      const trimmed = personalMailbox.trim();
      if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        toast({
          title: "Invalid Email",
          description: "Please enter a valid email address.",
          variant: "destructive",
        });
        setSavingMailbox(false);
        return;
      }

      const { data } = await invokeSecureFunction("admin-user-management", {
        action: "update_own_mailbox",
        personal_mailbox: trimmed || null,
      });

      if (data?.success) {
        // Reflect the saved (possibly trimmed/cleared) value back into local state
        setPersonalMailbox(trimmed);
        toast({
          title: "Mailbox Updated",
          description: trimmed
            ? "Your personal mailbox has been saved successfully."
            : "Your personal mailbox has been cleared.",
        });
        logActivityDirect({
          actionType: "settings_updated",
          entityType: "user",
          entityName: "Personal Mailbox",
          metadata: { setting: "personal_mailbox" },
        });
        // Re-fetch from backend to confirm persistence and avoid drift
        await fetchOwnProfile();
      } else {
        toast({
          title: "Error",
          description: data?.error || "Failed to update mailbox.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to update mailbox. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingMailbox(false);
    }
  };

  const handleSaveSignature = async () => {
    setSavingSignature(true);
    try {
      const { data } = await invokeSecureFunction("admin-user-management", {
        action: "update_own_signature",
        email_signature: emailSignature || null,
      });

      if (data?.success) {
        toast({
          title: "Signature Updated",
          description: "Your email signature has been saved successfully.",
        });
        logActivityDirect({
          actionType: "settings_updated",
          entityType: "user",
          entityName: "Email Signature",
          metadata: { setting: "email_signature" },
        });
      } else {
        toast({
          title: "Error",
          description: data?.error || "Failed to update signature.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to update signature. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingSignature(false);
    }
  };

  // Load settings from localStorage on component mount
  useEffect(() => {
    const savedSettings = localStorage.getItem("dashboard-settings");
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setSettings((prev) => ({ ...prev, ...parsed }));
      } catch (error) {
        console.error("Failed to parse saved settings:", error);
      }
    }
  }, []);

  const handleSettingChange = (key: string, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const saveAllSettings = async () => {
    setIsSaving(true);
    try {
      // Save settings to localStorage
      localStorage.setItem("dashboard-settings", JSON.stringify(settings));

      // Apply notification settings
      if (settings.notifications && "Notification" in window) {
        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
      }

      toast({
        title: "Settings Saved",
        description: "Your preferences have been saved successfully.",
      });
      logActivityDirect({
        actionType: "settings_updated",
        entityType: "system",
        entityName: "Dashboard Settings",
        metadata: settings,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save settings. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DashboardThemeFrame
      as="main"
      variant="page"
      className="settings-page min-h-[calc(100vh-5rem)] space-y-5 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.10),transparent_32%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--muted)/0.16))] p-3 pb-24 sm:p-5 md:space-y-6 md:p-6 md:pb-8 [&_.rounded-lg]:min-w-0 [&_.rounded-lg]:overflow-hidden [&_.rounded-lg]:rounded-2xl [&_.rounded-lg]:shadow-[0_18px_44px_hsl(var(--foreground)/0.07)] [&_button]:min-w-0 [&_input]:min-w-0 [&_table]:w-full [&_td]:min-w-0 [&_textarea]:min-w-0 [&_th]:min-w-0"
    >
      {/* Developer note: Settings UI-only polish. Touched src/pages/Settings.tsx; intentionally left authentication, permissions, Supabase/API contracts, credential handling, notification registration, migration safeguards, key rotation, pricing/catalog data, and report-generation behaviour untouched. */}
      <DashboardThemeFrame
        as="header"
        variant="hero"
        className="min-w-0 border-primary/20 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.18),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.86)_55%,hsl(var(--primary)/0.08))] shadow-[0_24px_70px_hsl(var(--foreground)/0.10)] dark:shadow-black/35"
      >
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary shadow-sm">
              <SettingsIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Administrative control centre</span>
            </div>
            <div className="min-w-0 space-y-2">
              <h1 className="break-words text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Settings
              </h1>
              <p className="max-w-3xl break-words text-sm leading-6 text-muted-foreground md:text-base">
                Configure your dashboard and manage connections
              </p>
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3 lg:w-auto">
            {["Secure access", "Theme ready", "Workflow safe"].map((label) => (
              <div
                key={label}
                className="dashboard-surface-control flex min-w-0 items-center gap-2 rounded-2xl px-3 py-2 text-xs font-medium text-muted-foreground"
              >
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                <span className="truncate">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </DashboardThemeFrame>

      {/* Profile & Credentials */}
      <ProfileCredentials />

      {/* Push Notifications */}
      <PushNotificationToggle />

      {/* Internal message desktop alerts */}
      <DesktopMessageAlertsToggle />

      {/* Personal Mailbox Settings */}
      <Card className={settingsCardClass}>
        <CardHeader className="space-y-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-lg md:text-xl">
            <Mail className="h-5 w-5 shrink-0" />
            Personal Mailbox
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <div className={settingsCx(settingsPanelClass, "space-y-2")}>
            <Label htmlFor="personal-mailbox">Mailbox Email Address</Label>
            {loadingMailbox ? (
              <div className="rounded-xl border border-border/60 bg-muted/25 p-3 text-sm text-muted-foreground">
                Loading...
              </div>
            ) : (
              <>
                <Input
                  id="personal-mailbox"
                  className={settingsInputClass}
                  type="email"
                  placeholder="your.email@example.com"
                  value={personalMailbox}
                  onChange={(e) => setPersonalMailbox(e.target.value)}
                />
                <p className="break-words text-xs leading-5 text-muted-foreground">
                  This email will be used for your personal email communications
                  within the dashboard.
                </p>
              </>
            )}
          </div>

          <Button
            onClick={handleSaveMailbox}
            disabled={savingMailbox || loadingMailbox}
            aria-busy={savingMailbox}
            className={settingsCx(
              settingsPillButtonClass,
              settingsPrimaryButtonClass,
              "w-full",
            )}
          >
            {savingMailbox && (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            )}
            Save Mailbox
          </Button>
        </CardContent>
      </Card>

      {/* Email Signature Settings */}
      <Card className={settingsCardClass}>
        <CardHeader className="space-y-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-lg md:text-xl">
            <FileSignature className="h-5 w-5 shrink-0" />
            Email Signature
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <div className={settingsCx(settingsPanelClass, "space-y-2")}>
            <Label htmlFor="email-signature">Your Email Signature</Label>
            {loadingSignature ? (
              <div className="rounded-xl border border-border/60 bg-muted/25 p-3 text-sm text-muted-foreground">
                Loading...
              </div>
            ) : (
              <>
                <Textarea
                  id="email-signature"
                  placeholder="Best regards,&#10;Your Name&#10;Company Name&#10;Phone: +1 234 567 890"
                  value={emailSignature}
                  onChange={(e) => setEmailSignature(e.target.value)}
                  className={settingsCx(
                    settingsInputClass,
                    "min-h-[160px] resize-y whitespace-pre-wrap break-words font-mono text-sm leading-6",
                  )}
                />
                <p className="break-words text-xs leading-5 text-muted-foreground">
                  This signature will be automatically appended to all emails
                  sent from the Email Copilot. You can use plain text or HTML
                  formatting.
                </p>
              </>
            )}
          </div>

          <Button
            onClick={handleSaveSignature}
            disabled={savingSignature || loadingSignature}
            aria-busy={savingSignature}
            className={settingsCx(
              settingsPillButtonClass,
              settingsPrimaryButtonClass,
              "w-full",
            )}
          >
            {savingSignature && (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            )}
            Save Signature
          </Button>
        </CardContent>
      </Card>

      {/* Finance Agent Contacts */}
      <FinanceAgentContacts />

      {/* Comparison Score Migration — a run-once data-repair tool, internal console only */}
      {!isClientFacingDeployment() && <ComparisonScoreMigration />}

      {/* Builder Stock in the Property Marketplace (superadmin only — card hides itself otherwise) */}
      <BuilderStockMarketplaceCard />

      {/* Mission Control Key (superadmin only — card hides itself otherwise) */}
      <MissionControlKeyCard />

      {/* Plan & Seats (superadmin only) */}
      <SeatEntitlementCard />

      {/* Pricing & Catalog */}
      <PricingCatalogCard />

      {/* Entitlement Diagnostics (superadmin only — card hides itself otherwise) */}
      <EntitlementDiagnosticsCard />

      {/* Purchase History (attributed, from Mission Control) */}
      <PurchaseHistoryCard />

      {/* Active Devices */}
      <DeviceManagementCard />

      {/* Security Settings */}
      <Card className={settingsCardClass}>
        <CardHeader className="space-y-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-lg md:text-xl">
            <Shield className="h-5 w-5 shrink-0 text-primary" />
            Security & Access
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <div
            className={settingsCx(
              settingsPanelClass,
              "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
            )}
          >
            <div className="min-w-0 space-y-1">
              <h4 className="text-sm font-medium">API Token Status</h4>
              <p className="text-xs text-muted-foreground">
                Personal access token for Airtable API
              </p>
            </div>
            <Badge variant="success" className={settingsBadgePillClass}>
              Configured
            </Badge>
          </div>

          <Separator />

          <div className={settingsCx(settingsPanelClass, "space-y-4")}>
            <h4 className="text-sm font-semibold">Authenticator app</h4>
            <TotpEnrollmentCard disabled={!canEditSettings} />
          </div>

          <Separator />

          <div className={settingsCx(settingsPanelClass, "space-y-4")}>
            <h4 className="text-sm font-semibold">Recovery codes</h4>
            <RecoveryCodeCard disabled={!canEditSettings} />
          </div>

          <Separator />

          <div className={settingsCx(settingsPanelClass, "space-y-4")}>
            <h4 className="text-sm font-semibold">Security keys & passkeys</h4>
            <WebAuthnSettings disabled={!canEditSettings} />
          </div>

          <Separator />

          <div className={settingsCx(settingsPanelClass, "space-y-4")}>
            <h4 className="text-sm font-semibold">User Permissions</h4>
            <div className="space-y-2">
              <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-muted/25 px-3 py-2">
                <span className="min-w-0 break-words text-sm">
                  Read listings data
                </span>
                <Badge variant="success" className={settingsBadgePillClass}>
                  Enabled
                </Badge>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-muted/25 px-3 py-2">
                <span className="min-w-0 break-words text-sm">
                  Export CSV data
                </span>
                <Badge variant="success" className={settingsBadgePillClass}>
                  Enabled
                </Badge>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-muted/25 px-3 py-2">
                <span className="min-w-0 break-words text-sm">
                  Modify listing data
                </span>
                <Badge variant="outline" className={settingsBadgePillClass}>
                  Disabled
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Display Settings */}
      <Card className={settingsAccentCardClass}>
        <CardHeader className="space-y-2 pb-3 md:pb-6">
          <CardTitle className="flex min-w-0 items-center gap-2 text-lg md:text-xl">
            <Palette className="h-4 w-4 shrink-0 text-primary md:h-5 md:w-5" />
            Display & Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <div className="space-y-4">
            <div
              className={settingsCx(
                settingsPanelClass,
                "flex flex-col justify-between gap-3 sm:flex-row sm:items-center",
              )}
            >
              <div className="min-w-0 space-y-1">
                <h4 className="text-sm font-medium">Theme</h4>
                <p className="text-xs text-muted-foreground">
                  Choose your preferred color scheme
                </p>
              </div>
              <div className="grid min-w-0 grid-cols-3 gap-2 sm:flex">
                <Button
                  variant={themeMode === "light" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setThemeMode("light")}
                  className={settingsCx(
                    settingsPillButtonClass,
                    "sm:flex-none",
                  )}
                >
                  Light
                </Button>
                <Button
                  variant={themeMode === "dark" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setThemeMode("dark")}
                  className={settingsCx(
                    settingsPillButtonClass,
                    "sm:flex-none",
                  )}
                >
                  Dark
                </Button>
                <Button
                  variant={themeMode === "system" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setThemeMode("system")}
                  className={settingsCx(
                    settingsPillButtonClass,
                    "sm:flex-none",
                  )}
                >
                  System
                </Button>
              </div>
            </div>

            <Separator />

            {/* Booking Timezone (Source of Truth) */}
            <div
              className={settingsCx(
                settingsPanelClass,
                "flex flex-col justify-between gap-3 sm:flex-row sm:items-center",
              )}
            >
              <div className="min-w-0 space-y-1">
                <h4 className="text-sm font-medium">Booking Timezone</h4>
                <p className="text-xs text-muted-foreground">
                  Source of truth for all calendar bookings — times are
                  interpreted in this timezone
                </p>
              </div>
              <div className="w-full sm:w-64">
                <Select
                  value={settings.bookingTimezone}
                  onValueChange={(value) =>
                    handleSettingChange("bookingTimezone", value)
                  }
                >
                  <SelectTrigger className="min-w-0 focus:ring-primary">
                    <SelectValue placeholder="Select booking timezone" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[min(22rem,var(--radix-select-content-available-height))]">
                    <SelectItem value="Australia/Sydney">
                      Sydney (AEST/AEDT)
                    </SelectItem>
                    <SelectItem value="Australia/Melbourne">
                      Melbourne (AEST/AEDT)
                    </SelectItem>
                    <SelectItem value="Australia/Brisbane">
                      Brisbane (AEST)
                    </SelectItem>
                    <SelectItem value="Australia/Adelaide">
                      Adelaide (ACST/ACDT)
                    </SelectItem>
                    <SelectItem value="Australia/Perth">
                      Perth (AWST)
                    </SelectItem>
                    <SelectItem value="Australia/Darwin">
                      Darwin (ACST)
                    </SelectItem>
                    <SelectItem value="Australia/Hobart">
                      Hobart (AEST/AEDT)
                    </SelectItem>
                    <SelectItem value="Australia/Lord_Howe">
                      Lord Howe Island (LHST/LHDT)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Display Timezone (Reference) */}
            <div
              className={settingsCx(
                settingsPanelClass,
                "flex flex-col justify-between gap-3 sm:flex-row sm:items-center",
              )}
            >
              <div className="min-w-0 space-y-1">
                <h4 className="text-sm font-medium">Display Timezone</h4>
                <p className="text-xs text-muted-foreground">
                  Your local timezone for secondary time reference display
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Detected: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </p>
              </div>
              <div className="w-full sm:w-64">
                <Select
                  value={settings.timezone}
                  onValueChange={(value) =>
                    handleSettingChange("timezone", value)
                  }
                >
                  <SelectTrigger className="min-w-0 focus:ring-primary">
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[min(22rem,var(--radix-select-content-available-height))]">
                    <SelectItem value="Australia/Sydney">
                      Australia/Sydney (AEST/AEDT)
                    </SelectItem>
                    <SelectItem value="Australia/Melbourne">
                      Australia/Melbourne (AEST/AEDT)
                    </SelectItem>
                    <SelectItem value="Australia/Brisbane">
                      Australia/Brisbane (AEST)
                    </SelectItem>
                    <SelectItem value="Australia/Adelaide">
                      Australia/Adelaide (ACST/ACDT)
                    </SelectItem>
                    <SelectItem value="Australia/Perth">
                      Australia/Perth (AWST)
                    </SelectItem>
                    <SelectItem value="Australia/Darwin">
                      Australia/Darwin (ACST)
                    </SelectItem>
                    <SelectItem value="Australia/Hobart">
                      Australia/Hobart (AEST/AEDT)
                    </SelectItem>
                    <SelectItem value="Pacific/Auckland">
                      New Zealand (NZST/NZDT)
                    </SelectItem>
                    <SelectItem value="Asia/Singapore">
                      Singapore (SGT)
                    </SelectItem>
                    <SelectItem value="Asia/Hong_Kong">
                      Hong Kong (HKT)
                    </SelectItem>
                    <SelectItem value="Asia/Tokyo">Japan (JST)</SelectItem>
                    <SelectItem value="Asia/Kolkata">India (IST)</SelectItem>
                    <SelectItem value="Asia/Dubai">Dubai (GST)</SelectItem>
                    <SelectItem value="Europe/London">
                      London (GMT/BST)
                    </SelectItem>
                    <SelectItem value="America/New_York">
                      New York (EST/EDT)
                    </SelectItem>
                    <SelectItem value="America/Los_Angeles">
                      Los Angeles (PST/PDT)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            <div
              className={settingsCx(
                settingsPanelClass,
                "flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center",
              )}
            >
              <div className="min-w-0 space-y-1">
                <h4 className="text-sm font-medium">Browser Notifications</h4>
                <p className="text-xs text-muted-foreground">
                  Get notified about new listings and updates
                </p>
              </div>
              <Switch
                className={settingsSwitchClass}
                checked={settings.notifications}
                onCheckedChange={(checked) =>
                  handleSettingChange("notifications", checked)
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Performance Settings */}
      <Card className={settingsCardClass}>
        <CardHeader className="space-y-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-lg md:text-xl">
            <Clock className="h-5 w-5 shrink-0 text-primary" />
            Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <div
            className={settingsCx(
              settingsPanelClass,
              "flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center",
            )}
          >
            <div className="min-w-0 space-y-1">
              <h4 className="text-sm font-medium">Auto-refresh Data</h4>
              <p className="text-xs text-muted-foreground">
                Automatically refresh listings data
              </p>
            </div>
            <Switch
              className={settingsSwitchClass}
              checked={settings.autoRefresh}
              onCheckedChange={(checked) =>
                handleSettingChange("autoRefresh", checked)
              }
            />
          </div>

          {settings.autoRefresh && (
            <>
              <Separator />
              <div
                className={settingsCx(
                  settingsPanelClass,
                  "flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center",
                )}
              >
                <div className="min-w-0 space-y-1">
                  <h4 className="text-sm font-medium">Refresh Interval</h4>
                  <p className="text-xs text-muted-foreground">
                    How often to check for new data (minutes)
                  </p>
                </div>
                <div className="w-28 shrink-0">
                  <Input
                    className={settingsInputClass}
                    type="number"
                    min="1"
                    max="60"
                    value={settings.refreshInterval}
                    onChange={(e) =>
                      handleSettingChange(
                        "refreshInterval",
                        parseInt(e.target.value),
                      )
                    }
                  />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Report Generation Settings */}
      <Card className={settingsCardClass}>
        <CardHeader className="space-y-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-lg md:text-xl">
            <Zap className="h-5 w-5 shrink-0 text-primary" />
            Report Generation
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <div
            className={settingsCx(
              settingsPanelClass,
              "flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center",
            )}
          >
            <div className="min-w-0 space-y-1">
              <h4 className="text-sm font-medium">Auto-Continue Reports</h4>
              <p className="text-xs text-muted-foreground">
                Automatically resume stalled investment report generations
              </p>
            </div>
            <Switch
              className={settingsSwitchClass}
              checked={settings.autoContinueReports}
              onCheckedChange={(checked) =>
                handleSettingChange("autoContinueReports", checked)
              }
            />
          </div>

          {settings.autoContinueReports && (
            <>
              <Separator />
              <div
                className={settingsCx(
                  settingsPanelClass,
                  "flex flex-col justify-between gap-3 sm:flex-row sm:items-center",
                )}
              >
                <div className="min-w-0 space-y-1">
                  <h4 className="text-sm font-medium">Max Retry Attempts</h4>
                  <p className="text-xs text-muted-foreground">
                    Maximum times to auto-retry a stalled report (1-5)
                  </p>
                </div>
                <div className="w-28 shrink-0">
                  <Input
                    className={settingsInputClass}
                    type="number"
                    min="1"
                    max="5"
                    value={settings.autoContinueMaxRetries}
                    onChange={(e) =>
                      handleSettingChange(
                        "autoContinueMaxRetries",
                        Math.min(5, Math.max(1, parseInt(e.target.value) || 3)),
                      )
                    }
                  />
                </div>
              </div>

              <Separator />

              <div
                className={settingsCx(
                  settingsPanelClass,
                  "flex flex-col justify-between gap-3 sm:flex-row sm:items-center",
                )}
              >
                <div className="min-w-0 space-y-1">
                  <h4 className="text-sm font-medium">Retry Delay</h4>
                  <p className="text-xs text-muted-foreground">
                    Seconds to wait between retry attempts (10-60)
                  </p>
                </div>
                <div className="w-28 shrink-0">
                  <Input
                    className={settingsInputClass}
                    type="number"
                    min="10"
                    max="60"
                    value={settings.autoContinueDelaySeconds}
                    onChange={(e) =>
                      handleSettingChange(
                        "autoContinueDelaySeconds",
                        Math.min(
                          60,
                          Math.max(10, parseInt(e.target.value) || 15),
                        ),
                      )
                    }
                  />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Save Settings - Sticky on mobile */}
      <div className="fixed bottom-16 left-0 right-0 z-30 flex justify-end border-t bg-background/95 p-4 shadow-[0_-18px_42px_hsl(var(--foreground)/0.10)] backdrop-blur-sm md:relative md:bottom-auto md:border-0 md:bg-transparent md:p-0 md:shadow-none">
        <Button
          onClick={saveAllSettings}
          disabled={isSaving || !canEditSettings}
          aria-busy={isSaving}
          className={settingsCx(
            settingsPillButtonClass,
            settingsPrimaryButtonClass,
            "w-full md:w-auto",
          )}
        >
          {isSaving && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
          {!canEditSettings ? "View Only" : "Save Settings"}
        </Button>
      </div>
    </DashboardThemeFrame>
  );
}
