import { useCallback, useEffect, useState } from "react";
import {
  AURIXA_SAVE_CARD_URL,
  fetchPaymentMethods,
  openMissionControlWithAttribution,
  updatePaymentMethods,
  type PaymentMethodRecord,
  type PaymentMethodUpdate,
} from "@/lib/missionControl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, ArrowUp, CreditCard, Plus, RefreshCw, ShieldCheck, Star, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  classifyWalletError,
  friendlyWalletError,
  type WalletErrorKind,
} from "./walletErrors";

const ROLE_LABEL: Record<number, string> = { 1: "Primary", 2: "Secondary", 3: "Backup" };

function roleBadgeClass(priority: number): string {
  return priority === 1
    ? "border-primary/25 bg-primary/10 text-primary"
    : priority === 2
      ? "border-brand-500/25 bg-brand-500/10 text-brand-700 dark:text-brand-300"
      : "border-border/70 bg-muted/60 text-muted-foreground";
}

function cardExpiry(m: PaymentMethodRecord): string {
  if (!m.expMonth || !m.expYear) return "—";
  return `${String(m.expMonth).padStart(2, "0")}/${String(m.expYear).slice(-2)}`;
}

function isExpiringSoon(m: PaymentMethodRecord): boolean {
  if (!m.expMonth || !m.expYear) return false;
  const end = new Date(m.expYear, m.expMonth, 1); // first day after expiry month
  const inTwoMonths = new Date();
  inTwoMonths.setMonth(inTwoMonths.getMonth() + 2);
  return end <= inTwoMonths;
}

/**
 * Saved payment methods (Payment methods tab of Billing & Usage). Shows the
 * wallet's display references only — brand / last4 / expiry. Card details are
 * entered on Stripe's hosted page (launched via the pricing site), never
 * here, and only the Stripe payment-method reference is stored server-side.
 * Slots: Primary → Secondary → Backup, max 3 cards.
 */
export function PaymentMethodsPanel() {
  const [methods, setMethods] = useState<PaymentMethodRecord[]>([]);
  const [maxCards, setMaxCards] = useState(3);
  // What Stripe itself reports. `stripeVerified` false means we could not ask,
  // which the UI must present differently from "asked, and they disagree".
  const [stripeVerified, setStripeVerified] = useState(false);
  const [stripeDefaultId, setStripeDefaultId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<WalletErrorKind | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PaymentMethodRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorKind(null);
    // One silent retry for transient backend errors before surfacing anything.
    // Permanent failures (wallet tables not provisioned in Mission Control)
    // are surfaced immediately — retrying cannot fix those.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await fetchPaymentMethods();
        setMethods(result.paymentMethods);
        setMaxCards(result.maxPaymentMethods);
        setStripeVerified(result.stripeVerified === true);
        setStripeDefaultId(result.stripeDefaultPaymentMethodId ?? null);
        setError(null);
        setErrorKind(null);
        break;
      } catch (e) {
        const raw = e instanceof Error ? e.message : "Failed to load payment methods.";
        console.error("[wallet] load failed:", raw);
        const kind = classifyWalletError(raw);
        if (attempt === 0 && kind === "transient") {
          await new Promise((resolve) => setTimeout(resolve, 2500));
          continue;
        }
        setError(friendlyWalletError(raw));
        setErrorKind(kind);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh when the tab regains focus — the "Add card" flow completes in
  // another tab (Stripe-hosted), so this picks the new card up on return.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  async function applyUpdate(update: PaymentMethodUpdate, busyKey: string) {
    setBusyId(busyKey);
    try {
      const result = await updatePaymentMethods(update);
      setMethods(result.paymentMethods);
      setMaxCards(result.maxPaymentMethods);
      setStripeVerified(result.stripeVerified === true);
      setStripeDefaultId(result.stripeDefaultPaymentMethodId ?? null);
      toast.success(
        update.action === "remove"
          ? "Card removed at Stripe."
          : update.action === "make_primary"
            ? "Primary card updated — Stripe will now charge it."
            : update.action === "sync_default"
              ? "Stripe default re-synced."
              : "Card order updated.",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Update failed";
      console.error("[wallet] update failed:", msg);
      toast.error(
        /forbidden/i.test(msg)
          ? "Admin permission required to manage cards."
          : friendlyWalletError(msg),
      );
    } finally {
      setBusyId(null);
    }
  }

  function moveUp(m: PaymentMethodRecord) {
    const ordered = [...methods].sort((a, b) => a.priority - b.priority).map((x) => x.id);
    const idx = ordered.indexOf(m.id);
    if (idx <= 0) return;
    [ordered[idx - 1], ordered[idx]] = [ordered[idx], ordered[idx - 1]];
    void applyUpdate({ action: "reorder", orderedIds: ordered }, m.id);
  }

  const sorted = [...methods].sort((a, b) => a.priority - b.priority);

  // Drift: this workspace says one card is primary, Stripe will charge another.
  // Only claimed when Stripe actually answered — `stripeVerified` false means
  // we could not ask, and asserting a mismatch from ignorance would be worse
  // than saying nothing.
  const localPrimary = sorted.find((m) => m.priority === 1) ?? null;
  const stripeCharges = sorted.find((m) => m.isStripeDefault === true) ?? null;
  const defaultDrifted =
    stripeVerified && sorted.length > 0 && localPrimary?.isStripeDefault !== true;
  const orphaned = stripeVerified ? sorted.filter((m) => m.attachedAtStripe === false) : [];
  // While the wallet backend is unprovisioned, a card vaulted on Stripe's
  // page would never land in the wallet — block the entry point entirely.
  const canAdd = methods.length < maxCards && errorKind !== "not_provisioned";

  return (
    <Card className="min-w-0 overflow-hidden rounded-[1.75rem] border-border/70 bg-card/95 ring-1 ring-black/5 dark:border-white/10 dark:bg-background/75 dark:ring-white/5">
      <CardHeader className="border-b border-border/60 bg-[linear-gradient(135deg,hsl(var(--muted)/0.28),hsl(var(--card)/0.55))] px-4 py-5 sm:px-6">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex min-w-0 items-center gap-2 text-xl tracking-tight">
              <span className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary">
                <CreditCard className="h-5 w-5" />
              </span>
              <span className="truncate">Payment methods</span>
            </CardTitle>
            <CardDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Save up to {maxCards} debit or credit cards — a primary plus backups. Card details
              are entered on Stripe's secure page and never touch this dashboard; only the brand,
              last four digits and expiry are shown here.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-xl"
              onClick={load}
              disabled={loading}
              aria-label="Refresh payment methods"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            <Button
              className="h-10 rounded-xl px-4"
              disabled={!canAdd || loading}
              onClick={() => void openMissionControlWithAttribution("save_card", AURIXA_SAVE_CARD_URL)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add card
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4 p-4 sm:p-6">
        {error && (
          <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs text-destructive sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={load}
              disabled={loading}
            >
              Retry
            </Button>
          </div>
        )}

        {/* What Stripe actually holds. A wallet that only reports its own table
            can look perfectly healthy while Stripe charges a different card —
            which is the whole point of showing this. */}
        {!loading && sorted.length > 0 && (
          <div
            className={cn(
              "flex min-w-0 flex-col gap-3 rounded-2xl border px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between",
              defaultDrifted || orphaned.length > 0
                ? "border-warning/30 bg-warning/10 text-warning"
                : stripeVerified
                  ? "border-success/25 bg-success/10 text-foreground"
                  : "border-border/60 bg-muted/25 text-muted-foreground",
            )}
          >
            <div className="flex min-w-0 items-start gap-2">
              {stripeVerified ? (
                defaultDrifted || orphaned.length > 0 ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                )
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span className="min-w-0 break-words">
                {!stripeVerified
                  ? "Couldn't confirm these against Stripe just now — the list below is this workspace's record, which may be out of date."
                  : orphaned.length > 0
                    ? `Stripe no longer holds ${orphaned.length === 1 ? "one of these cards" : `${orphaned.length} of these cards`}. Remove and re-add to keep charges working.`
                    : defaultDrifted
                      ? stripeCharges
                        ? `Stripe will charge ${stripeCharges.brand ?? "the card"} •••• ${stripeCharges.last4 ?? "????"}, not the card marked Primary here.`
                        : "Stripe has no default card set, so renewals have nothing to charge."
                      : "Confirmed with Stripe — the Primary card below is the one Stripe will charge."}
              </span>
            </div>
            {(defaultDrifted || !stripeVerified) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 rounded-xl"
                disabled={busyId !== null || loading}
                onClick={() => void applyUpdate({ action: "sync_default" }, "sync")}
              >
                <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", busyId === "sync" && "animate-spin")} />
                Sync with Stripe
              </Button>
            )}
          </div>
        )}

        {loading && methods.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        ) : sorted.length === 0 && !error ? (
          <div className="flex min-h-[16rem] items-center justify-center rounded-3xl border border-dashed border-border/70 bg-muted/15 px-4 py-12 text-center">
            <div className="mx-auto max-w-sm space-y-3">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
                <CreditCard className="h-7 w-7" />
              </div>
              <p className="text-sm font-semibold text-foreground">No saved cards yet.</p>
              <p className="text-xs leading-5 text-muted-foreground">
                Add a card for faster checkout. You'll be taken to the pricing site, which opens
                Stripe's secure card page — your details cascade straight into Stripe.
              </p>
              <Button
                size="sm"
                className="rounded-xl"
                onClick={() => void openMissionControlWithAttribution("save_card", AURIXA_SAVE_CARD_URL)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add your first card
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map((m) => {
              const expiring = isExpiringSoon(m);
              return (
                <div
                  key={m.id}
                  className={cn(
                    "flex min-w-0 flex-col gap-3 rounded-2xl border bg-background/45 p-4 transition-colors sm:flex-row sm:items-center sm:justify-between",
                    m.priority === 1 ? "border-primary/30 bg-primary/5" : "border-border/70",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <div
                      className={cn(
                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border",
                        m.priority === 1
                          ? "border-primary/25 bg-primary/10 text-primary"
                          : "border-border/70 bg-muted/40 text-muted-foreground",
                      )}
                    >
                      <CreditCard className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold capitalize text-foreground">
                          {m.brand ?? "Card"} •••• {m.last4 ?? "????"}
                        </span>
                        <Badge variant="outline" className={cn("rounded-full px-2.5 py-0.5", roleBadgeClass(m.priority))}>
                          {ROLE_LABEL[m.priority] ?? `Slot ${m.priority}`}
                        </Badge>
                        {m.funding && (
                          <Badge variant="secondary" className="rounded-full border border-border/60 bg-muted/55 px-2.5 py-0.5 capitalize text-muted-foreground">
                            {m.funding}
                          </Badge>
                        )}
                        {/* The badge that matters: "Primary" is our record of
                            intent, this is Stripe's actual behaviour. */}
                        {m.isStripeDefault === true && (
                          <Badge variant="outline" className="rounded-full border-success/30 bg-success/10 px-2.5 py-0.5 text-success">
                            Stripe charges this
                          </Badge>
                        )}
                        {m.attachedAtStripe === false && (
                          <Badge variant="outline" className="rounded-full border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-destructive">
                            Not at Stripe
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        Expires{" "}
                        <span className={cn("font-medium", expiring ? "text-warning" : "text-foreground")}>
                          {cardExpiry(m)}
                        </span>
                        {expiring && " · expiring soon"}
                        {m.billingName && ` · ${m.billingName}`}
                        {m.originUsername && ` · added by ${m.originUsername}`}
                        {` · ${new Date(m.createdAt).toLocaleDateString('en-AU')}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {m.priority !== 1 && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 rounded-xl"
                          disabled={busyId !== null}
                          onClick={() => void applyUpdate({ action: "make_primary", paymentMethodId: m.id }, m.id)}
                        >
                          <Star className="mr-1.5 h-3.5 w-3.5" />
                          Make primary
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 rounded-xl"
                          disabled={busyId !== null}
                          aria-label="Move card up in fallback order"
                          onClick={() => moveUp(m)}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10"
                      disabled={busyId !== null}
                      aria-label={`Remove ${m.brand ?? "card"} ending ${m.last4 ?? ""}`}
                      onClick={() => setRemoveTarget(m)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-border/60 bg-muted/25 px-4 py-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 break-words">
            PCI-safe by design: card numbers go browser → Stripe on Stripe's hosted page. This
            workspace stores only a reference. The primary card is set as the default for renewals;
            managing cards requires admin permission.
          </span>
        </div>
      </CardContent>

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this card?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget
                ? `${removeTarget.brand ?? "Card"} •••• ${removeTarget.last4 ?? ""} will be detached from Stripe and removed from this workspace's wallet. ${
                    removeTarget.priority === 1 && methods.length > 1
                      ? "Your secondary card will become the new primary."
                      : ""
                  }`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep card</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removeTarget) {
                  void applyUpdate({ action: "remove", paymentMethodId: removeTarget.id }, removeTarget.id);
                }
                setRemoveTarget(null);
              }}
            >
              Remove card
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
