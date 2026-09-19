import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { User, Key, RefreshCw, AlertCircle, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { validatePassword } from "@/utils/passwordValidation";
import { PasswordStrengthMeter } from "@/components/ui/password-strength-meter";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import {
  settingsCardClass,
  settingsCx,
  settingsInputClass,
  settingsPanelClass,
  settingsPrimaryButtonClass,
  settingsSubtlePanelClass,
} from "@/components/settings/settingsUi";

export function ProfileCredentials() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [profile, setProfile] = useState<{
    username: string;
    email: string | null;
    role: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  // Billing contact details. These ride along on the Mission Control handoff
  // when the user starts a purchase or saves a card, so Stripe's hosted page
  // opens with their name and email already filled in.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [savedContact, setSavedContact] = useState({ firstName: "", lastName: "", phone: "" });
  const [updatingContact, setUpdatingContact] = useState(false);

  // Username update
  const [newUsername, setNewUsername] = useState("");
  const [updatingUsername, setUpdatingUsername] = useState(false);

  // Password update
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const { data } = await invokeSecureFunction("admin-user-management", {
        action: "get_own_profile",
      });

      if (data?.success && data.user) {
        setProfile({
          username: data.user.username,
          email: data.user.email,
          role: data.user.role,
        });
        setNewUsername(data.user.username);
        const contact = {
          firstName: data.user.first_name ?? "",
          lastName: data.user.last_name ?? "",
          phone: data.user.phone ?? "",
        };
        setFirstName(contact.firstName);
        setLastName(contact.lastName);
        setPhone(contact.phone);
        setSavedContact(contact);
      }
    } catch (err) {
      console.error("Failed to fetch profile:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUsername = async () => {
    if (!newUsername.trim()) return;

    if (newUsername.trim().length < 3) {
      toast({
        title: "Invalid Username",
        description: "Username must be at least 3 characters.",
        variant: "destructive",
      });
      return;
    }

    if (newUsername.length > 100) {
      toast({
        title: "Invalid Username",
        description: "Username must be no more than 100 characters.",
        variant: "destructive",
      });
      return;
    }

    setUpdatingUsername(true);
    try {
      const { data } = await invokeSecureFunction("admin-user-management", {
        action: "update_own_credentials",
        new_username: newUsername.trim(),
      });

      if (data?.success) {
        setProfile((prev) =>
          prev ? { ...prev, username: newUsername.trim() } : prev,
        );
        toast({
          title: "Username Updated",
          description: "Your username has been changed successfully.",
        });
      } else {
        toast({
          title: "Error",
          description: data?.error || "Failed to update username.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to update username. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUpdatingUsername(false);
    }
  };

  const handleUpdateContact = async () => {
    setUpdatingContact(true);
    try {
      const { data } = await invokeSecureFunction("admin-user-management", {
        action: "update_own_profile",
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
      });

      if (data?.success) {
        setSavedContact({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim(),
        });
        toast({
          title: "Contact Details Saved",
          description: "Checkout and card forms will be prefilled with these details.",
        });
      } else {
        toast({
          title: "Error",
          description: data?.error || "Failed to save contact details.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to save contact details. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUpdatingContact(false);
    }
  };

  const handleUpdatePassword = async () => {
    setPasswordError("");

    if (!currentPassword) {
      setPasswordError("Current password is required");
      return;
    }

    // Validate password strength
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      setPasswordError(
        validation.error || "Password does not meet requirements",
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }

    setUpdatingPassword(true);
    try {
      const { data } = await invokeSecureFunction("admin-user-management", {
        action: "update_own_credentials",
        current_password: currentPassword,
        new_password: newPassword,
      });

      if (data?.success) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        toast({
          title: "Password Updated",
          description: "Your password has been changed successfully.",
        });
      } else {
        setPasswordError(data?.error || "Failed to update password");
      }
    } catch (err) {
      setPasswordError("Failed to update password. Please try again.");
    } finally {
      setUpdatingPassword(false);
    }
  };

  if (loading) {
    return (
      <Card className={settingsCardClass}>
        <CardHeader className="space-y-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-lg md:text-xl">
            <User className="h-5 w-5" />
            Profile & Credentials
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            Loading...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <Card className={settingsCardClass}>
      <CardHeader className="space-y-2">
        <CardTitle className="flex min-w-0 items-center gap-2 text-lg md:text-xl">
          <User className="h-5 w-5" />
          Profile & Credentials
        </CardTitle>
        <CardDescription className="max-w-2xl break-words leading-6">
          Update your contact details, username and password
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-6">
        {/* Current Info */}
        <div className="min-w-0 space-y-3 rounded-2xl border border-border/60 bg-muted/35 p-4 shadow-inner dark:border-white/10 dark:bg-background/35">
          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="text-sm text-muted-foreground">
              Current Username
            </span>
            <span className="min-w-0 break-words text-right font-medium">
              {profile.username}
            </span>
          </div>
          {profile.email && (
            <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="min-w-0 break-all text-right font-medium">
                {profile.email}
              </span>
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="text-sm text-muted-foreground">Role</span>
            <span className="min-w-0 break-words text-right font-medium">
              {profile.role === "super_admin"
                ? "Super Administrator"
                : profile.role === "sub_admin"
                  ? "Administrator"
                  : profile.role
                      .replace("_", " ")
                      .replace(/\b\w/g, (l) => l.toUpperCase())}
            </span>
          </div>
        </div>

        <Separator />

        {/* Billing contact — prefills Stripe checkout */}
        <div className={settingsCx(settingsPanelClass, "space-y-4")}>
          <h4 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <CreditCard className="h-4 w-4" />
            Contact Details
          </h4>
          <p className="text-xs leading-5 text-muted-foreground">
            Used to prefill your name and email when you buy credits or save a card, so
            you don&apos;t retype them on Stripe&apos;s payment page. Optional.
          </p>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="contact-first-name">First Name</Label>
              <Input
                id="contact-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={100}
                autoComplete="given-name"
                placeholder="Jane"
                disabled={updatingContact}
                className={settingsInputClass}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="contact-last-name">Last Name</Label>
              <Input
                id="contact-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={100}
                autoComplete="family-name"
                placeholder="Doe"
                disabled={updatingContact}
                className={settingsInputClass}
              />
            </div>
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="contact-phone">Phone</Label>
            <Input
              id="contact-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={40}
              autoComplete="tel"
              placeholder="+61 400 000 000"
              disabled={updatingContact}
              className={settingsInputClass}
            />
          </div>
          {profile.email && (
            <p className="text-xs leading-5 text-muted-foreground">
              Purchase receipts go to <span className="font-medium text-foreground">{profile.email}</span>.
              Ask an administrator to change your account email.
            </p>
          )}
          <Button
            onClick={handleUpdateContact}
            disabled={
              updatingContact ||
              (firstName.trim() === savedContact.firstName &&
                lastName.trim() === savedContact.lastName &&
                phone.trim() === savedContact.phone)
            }
            className={settingsCx(settingsPrimaryButtonClass, "w-full")}
          >
            {updatingContact && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
            Save Contact Details
          </Button>
        </div>

        <Separator />

        {/* Update Username */}
        <div className={settingsCx(settingsPanelClass, "space-y-4")}>
          <h4 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <User className="h-4 w-4" />
            Change Username
          </h4>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="new-username">New Username</Label>
            <Input
              id="new-username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              maxLength={100}
              placeholder="Enter new username"
              disabled={updatingUsername}
              className={settingsInputClass}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Username must be between 3 and 100 characters.
            </p>
          </div>
          <Button
            onClick={handleUpdateUsername}
            disabled={
              updatingUsername ||
              newUsername === profile.username ||
              !newUsername.trim()
            }
            className={settingsCx(settingsPrimaryButtonClass, "w-full")}
          >
            {updatingUsername && (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            )}
            Update Username
          </Button>
        </div>

        <Separator />

        {/* Update Password */}
        <div className={settingsCx(settingsPanelClass, "space-y-4")}>
          <h4 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <Key className="h-4 w-4" />
            Change Password
          </h4>

          {passwordError && (
            <Alert
              variant="destructive"
              className="min-w-0 overflow-hidden rounded-2xl"
            >
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="break-words">
                {passwordError}
              </AlertDescription>
            </Alert>
          )}

          <div className="min-w-0 space-y-2">
            <Label htmlFor="current-password">Current Password</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              disabled={updatingPassword}
              className={settingsInputClass}
            />
          </div>

          <div className="min-w-0 space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password (min 8 characters)"
              disabled={updatingPassword}
              className={settingsInputClass}
            />
            <div className={settingsCx(settingsSubtlePanelClass, "rounded-xl")}>
              <PasswordStrengthMeter password={newPassword} />
            </div>
          </div>

          <div className="min-w-0 space-y-2">
            <Label htmlFor="confirm-password">Confirm New Password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              disabled={updatingPassword}
              className={settingsInputClass}
            />
          </div>

          <Button
            onClick={handleUpdatePassword}
            disabled={
              updatingPassword ||
              !currentPassword ||
              !newPassword ||
              !confirmPassword
            }
            className={settingsCx(settingsPrimaryButtonClass, "w-full")}
          >
            {updatingPassword && (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            )}
            Update Password
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
