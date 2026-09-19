import { useCallback, useEffect, useState } from "react";
import { HardHat, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import {
  BUILDER_STOCK_FLAG_KEY, coerceFlagEnabled, useInvalidateBuilderStockFlag,
} from "@/hooks/useBuilderStockMarketplaceFlag";
import {
  settingsAccentCardClass,
  settingsBadgePillClass,
  settingsCx,
  settingsSwitchClass,
} from "@/components/settings/settingsUi";

/**
 * Settings — “Show Builder Stock in Property Marketplace”.
 *
 * The state is a row in `public.feature_flags`, not a browser preference: it
 * governs what a whole workspace sees, and the edge function that serves
 * builder stock reads the SAME row before answering any request. A
 * localStorage toggle would hide a tab while leaving the endpoint open, which
 * is not a switch.
 *
 * Mediated by `feature-flags-admin`, which re-checks the superadmin role
 * server-side — the table's RLS policy cannot fire for this app's custom
 * session, so the function is the control and this card is the surface.
 */
export function BuilderStockMarketplaceCard() {
  const { isSuperadmin } = useAuth();
  const { toast } = useToast();
  const invalidateFlag = useInvalidateBuilderStockFlag();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await invokeSecureFunction("feature-flags-admin", {
        operation: "get",
        key: BUILDER_STOCK_FLAG_KEY,
      });
      const row = (data as { row?: { value?: unknown; updated_at?: string } } | null)?.row;
      if (!row) {
        // No row yet is the same as off. Saving creates it.
        setEnabled(false);
        setUpdatedAt(null);
      } else {
        setEnabled(coerceFlagEnabled(row.value));
        setUpdatedAt(row.updated_at ?? null);
      }
      setUnreadable(false);
    } catch {
      setUnreadable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperadmin) void load();
    else setLoading(false);
  }, [isSuperadmin, load]);

  // Only an operator may change it, and only an operator is shown it — the
  // card is not a disabled control everybody else has to look at.
  if (!isSuperadmin) return null;

  const save = async (next: boolean) => {
    setSaving(true);
    const previous = enabled;
    setEnabled(next);
    try {
      const { data, error } = await invokeSecureFunction("feature-flags-admin", {
        operation: "upsert",
        key: BUILDER_STOCK_FLAG_KEY,
        value: { enabled: next },
        description:
          "Show Builder Stock in Property Marketplace. Read by the Listings page to render the tab and re-checked server-side by builder-stock-marketplace on every operation.",
      });
      const message = error?.message || (data as { error?: string } | null)?.error;
      if (message) throw new Error(message);

      const row = (data as { row?: { updated_at?: string } } | null)?.row;
      setUpdatedAt(row?.updated_at ?? new Date().toISOString());
      invalidateFlag();
      toast({
        title: next
          ? "Builder Stock is now available in the Property Marketplace"
          : "Builder Stock is hidden from the Property Marketplace",
      });
    } catch (caught) {
      setEnabled(previous);
      toast({
        title: "The setting could not be saved",
        description: (caught as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={settingsCx(settingsAccentCardClass)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <HardHat className="h-5 w-5" />
          Builder Stock
        </CardTitle>
        <Badge variant="outline" className={settingsCx(settingsBadgePillClass)}>
          Workspace setting
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="builder-stock-marketplace-toggle" className="text-sm font-medium">
              Show Builder Stock in Property Marketplace
            </Label>
            <p className="mt-1 text-sm text-muted-foreground">
              Adds a Builder Stock tab to the Property Marketplace showing properties
              builders have uploaded through their portal. When off, the tab is hidden
              and the service refuses every request for builder stock.
            </p>
            {updatedAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Last changed {new Date(updatedAt).toLocaleString("en-AU")}
              </p>
            ) : null}
            {unreadable ? (
              <p className="mt-1 text-xs text-destructive">
                The current setting could not be read. It is treated as off until it can be.
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {loading || saving ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
            ) : null}
            <Switch
              id="builder-stock-marketplace-toggle"
              className={settingsCx(settingsSwitchClass)}
              checked={enabled}
              disabled={loading || saving}
              onCheckedChange={(next) => void save(next)}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default BuilderStockMarketplaceCard;
