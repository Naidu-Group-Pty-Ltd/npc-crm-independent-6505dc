import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Building2,
  DollarSign,
  TrendingUp,
  TrendingDown,
  MoreVertical,
  Eye,
  Trash2,
  ExternalLink,
  RefreshCw,
  Star,
  Mail,
  Phone,
} from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { FollowUpFlag } from './FollowUpFlag';
import { SyncToGHLDialog } from './SyncToGHLDialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { invalidateClientQueries } from '@/lib/clients/invalidateClientQueries';

/**
 * Pipeline stage → status-chip tone.
 *
 * The chips are the dashboard's own `dashboard-status-chip-*` vocabulary
 * (src/styles/report-qa.css), so a stage reads the same here as it does on
 * the deal pipeline and the activity log.
 */
const getPipelineChipTone = (status: string | null | undefined) => {
  if (!status) return 'dashboard-status-chip-neutral';
  if (status.includes('No Show') || status.includes('No Response')) return 'dashboard-status-chip-destructive';
  if (status.includes('Discovery') || status.includes('Strategy') || status.includes('POP')) {
    return 'dashboard-status-chip-accent';
  }
  if (status.includes('Finance Link') || status.includes('FA -')) return 'dashboard-status-chip-success';
  return 'dashboard-status-chip-info';
};

interface ClientCardProps {
  client: {
    id: string;
    primary_first_name: string;
    primary_surname: string;
    primary_email: string | null;
    primary_mobile: string | null;
    secondary_first_name: string | null;
    secondary_surname: string | null;
    ghl_contact_id: string | null;
    ghl_sync_status: string | null;
    total_portfolio_value: number;
    total_debt: number;
    net_monthly_cash_flow: number;
    created_at: string;
    is_favorite?: boolean;
    client_properties?: { id: string }[];
    pipeline_status?: string | null;
    follow_up_date?: string | null;
    deal_status?: string;
  };
  ghlLocationId?: string | null;
  onView: () => void;
  onDelete?: () => void;
  onSyncComplete?: () => void;
  isSelected?: boolean;
  onSelect?: (checked: boolean) => void;
}

const currency = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Compact form for the metric tiles — a full $42,866,005 will not fit in a third of a card. */
const compactCurrency = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

function initialsFor(first: string, last: string) {
  const letters = `${first?.[0] ?? ''}${last?.[0] ?? ''}`.trim();
  return letters ? letters.toUpperCase() : '—';
}

function MetricTile({
  icon: Icon,
  label,
  value,
  title,
  valueClassName,
  className,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  title?: string;
  valueClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn('glass-inset min-w-0 rounded-xl px-3 py-2.5', className)}>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {/* The icon is decorative and the first thing to go when the tile is
            a third of a narrow card — the label has to survive, not the glyph. */}
        <Icon className="hidden h-3.5 w-3.5 shrink-0 sm:block" aria-hidden="true" />
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.06em]">{label}</span>
      </div>
      <p
        title={title ?? value}
        className={cn('mt-1.5 truncate text-base font-semibold leading-none tabular-nums text-foreground', valueClassName)}
      >
        {value}
      </p>
    </div>
  );
}

export function ClientCard({ client, ghlLocationId, onView, onDelete, onSyncComplete, isSelected, onSelect }: ClientCardProps) {
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const queryClient = useQueryClient();
  const propertyCount = client.client_properties?.length || 0;
  const cashFlow = Number(client.net_monthly_cash_flow) || 0;
  const isPositiveCashFlow = cashFlow >= 0;

  const toggleFavoriteMutation = useMutation({
    mutationFn: async () => {
      // Use secure Edge Function with HttpOnly cookie auth
      try {
        const { data, error } = await invokeSecureFunction('manage-client-data', {
          operation: 'update',
          table: 'clients',
          clientId: client.id,
          data: { is_favorite: !client.is_favorite },
        });

        if (!error && data?.success) {
          return;
        }
      } catch (err) {
        console.warn('Edge function failed, falling back to direct query:', err);
      }

      // Fallback to direct query
      const { error } = await supabase
        .from('clients')
        .update({ is_favorite: !client.is_favorite })
        .eq('id', client.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateClientQueries(queryClient, client.id);
      toast.success(client.is_favorite ? 'Removed from favorites' : 'Added to favorites');
    },
    onError: (error: any) => {
      toast.error('Failed to update favorite: ' + error.message);
    }
  });

  const handleSyncToGHL = () => {
    setShowSyncDialog(true);
  };

  const ghlStatus = (() => {
    switch (client.ghl_sync_status) {
      case 'synced':
        return { tone: 'dashboard-status-chip-success', label: 'Synced' };
      case 'pending':
        return { tone: 'dashboard-status-chip-warning', label: 'Pending sync' };
      case 'error':
        return { tone: 'dashboard-status-chip-destructive', label: 'Sync error' };
      default:
        return { tone: 'dashboard-status-chip-neutral', label: 'Not synced' };
    }
  })();

  const fullName = `${client.primary_first_name} ${client.primary_surname}`.trim() || 'Unknown client';
  const hasSecondary = client.secondary_first_name && client.secondary_surname;
  const secondaryName = hasSecondary
    ? `${client.secondary_first_name} ${client.secondary_surname}`
    : null;
  const showPipeline = client.pipeline_status && client.pipeline_status !== 'New Lead';

  return (
    <Card
      className={cn(
        'dashboard-theme-premium-card glass-interactive group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border',
        client.is_favorite && 'border-primary/35',
        isSelected && 'border-primary/50 ring-1 ring-primary/25'
      )}
    >
      {isSelected && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-primary/80" aria-hidden="true" />
      )}

      <div className="relative flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-5">
        {/* Identity */}
        <div className="flex min-w-0 items-start gap-3">
          {onSelect && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={onSelect}
              aria-label={`Select ${fullName}`}
              className="mt-3 shrink-0"
            />
          )}

          <span
            aria-hidden="true"
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-sm font-semibold tracking-wide text-primary sm:flex"
          >
            {initialsFor(client.primary_first_name, client.primary_surname)}
          </span>

          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onView}
              className="block max-w-full truncate rounded-sm text-left text-[15px] font-semibold leading-tight tracking-tight text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {fullName}
            </button>
            {secondaryName && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">&amp; {secondaryName}</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-8 w-8 rounded-lg text-muted-foreground hover:text-primary',
                client.is_favorite && 'text-primary'
              )}
              onClick={() => toggleFavoriteMutation.mutate()}
              disabled={toggleFavoriteMutation.isPending}
              aria-pressed={!!client.is_favorite}
              aria-label={client.is_favorite ? `Unstar ${fullName}` : `Star ${fullName}`}
            >
              <Star className={cn('h-4 w-4', client.is_favorite && 'fill-current')} />
            </Button>

            <FollowUpFlag clientId={client.id} followUpDate={client.follow_up_date} size="sm" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                  aria-label={`Open actions for ${fullName}`}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              {/* Secondary actions only. `View details` is the card's own
                  button now — an overflow copy of a control already on the
                  card is a second place for the same thing to drift. */}
              <DropdownMenuContent align="end" sideOffset={8} className="w-48 rounded-xl p-1.5 text-sm">
                <DropdownMenuItem onClick={handleSyncToGHL} className="rounded-lg">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync to GHL
                </DropdownMenuItem>
                {client.ghl_contact_id && ghlLocationId && (
                  <DropdownMenuItem asChild className="rounded-lg">
                    <a
                      href={`https://app.gohighlevel.com/v2/location/${ghlLocationId}/contacts/detail/${client.ghl_contact_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />View in GHL
                    </a>
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onDelete} className="rounded-lg text-destructive focus:text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" />Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Contact */}
        <div className="glass-inset min-w-0 space-y-1.5 rounded-xl px-3 py-2.5">
          <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate" title={client.primary_email || undefined}>
              {client.primary_email || 'No email on file'}
            </span>
          </p>
          <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{client.primary_mobile || 'No phone on file'}</span>
          </p>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <MetricTile icon={Building2} label="Properties" value={propertyCount.toLocaleString('en-AU')} />
          <MetricTile
            icon={DollarSign}
            label="Portfolio"
            value={compactCurrency.format(Number(client.total_portfolio_value) || 0)}
            title={currency.format(Number(client.total_portfolio_value) || 0)}
          />
          <MetricTile
            icon={isPositiveCashFlow ? TrendingUp : TrendingDown}
            label="Cash flow"
            value={compactCurrency.format(cashFlow)}
            title={`${currency.format(cashFlow)} per month`}
            valueClassName={isPositiveCashFlow ? 'text-success' : 'text-destructive'}
            className="col-span-2 sm:col-span-1"
          />
        </div>

        {/* Status footer */}
        <div className="mt-auto space-y-3 pt-1">
          <hr className="glass-divider" />

          {/*
            Opening a client was three interactions — find the card, open the
            overflow menu, pick the item — for the most frequent action on the
            page. It is one now. Same `onView`, so the card has one route into
            the record rather than two that can disagree; the name above stays
            clickable because a person who has already learned it will use it.
          */}
          <Button
            variant="outline"
            size="sm"
            onClick={onView}
            className="w-full justify-center gap-2 rounded-lg"
            aria-label={`View details for ${fullName}`}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            View details
          </Button>

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {showPipeline && (
                <span
                  className={cn('dashboard-status-chip max-w-[12rem] truncate', getPipelineChipTone(client.pipeline_status))}
                  title={`Pipeline: ${client.pipeline_status}`}
                >
                  {client.pipeline_status}
                </span>
              )}
              {client.deal_status === 'closed' && (
                <span className="dashboard-status-chip dashboard-status-chip-success">Deal closed</span>
              )}
            </div>
            <span
              className={cn('dashboard-status-chip shrink-0', ghlStatus.tone)}
              title={`GoHighLevel: ${ghlStatus.label}`}
            >
              <span className="text-muted-foreground">GHL</span>
              {ghlStatus.label}
            </span>
          </div>
        </div>
      </div>

      <SyncToGHLDialog
        open={showSyncDialog}
        onOpenChange={setShowSyncDialog}
        clientId={client.id}
        clientName={fullName}
        onSyncComplete={onSyncComplete}
      />
    </Card>
  );
}
