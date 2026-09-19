import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import {
  Plus,
  Building2,
  Home,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Deal, DealType, RISK_STATUS_CONFIG, DEAL_TYPE_LABELS } from './types';
import { deriveDealJourney } from '@/lib/deals/dealJourney.pure';
import { DealDetailView } from './DealDetailView';
import { useDealActions } from './useDealActions';
import { TeamUserSelect } from '@/components/ui/TeamUserSelect';
import { useTeamUsers } from '@/hooks/useTeamUsers';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useAuth } from '@/hooks/useAuth';

interface DealTrackerTabProps {
  clientId: string;
  deals: Deal[];
  properties: any[];
  initialDealId?: string;
}

export function DealTrackerTab({ clientId, deals, properties, initialDealId }: DealTrackerTabProps) {
  const [selectedDealId, setSelectedDealId] = useState<string | null>(initialDealId || null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newDealType, setNewDealType] = useState<DealType>('existing_property');
  const [responsibleUserId, setResponsibleUserId] = useState('unassigned');
  const { createDeal } = useDealActions(clientId);
  const { data: teamUsers = [] } = useTeamUsers();
  const { addNotification } = useNotifications();
  const { user } = useAuth();

  // Auto-select deal when deep-linked and deals load
  useEffect(() => {
    if (initialDealId && deals.length > 0 && !selectedDealId) {
      const found = deals.find(d => d.id === initialDealId);
      if (found) setSelectedDealId(found.id);
    }
  }, [initialDealId, deals]);

  const selectedDeal = deals.find(d => d.id === selectedDealId);

  const handleCreate = () => {
    const assignedUserId = responsibleUserId !== 'unassigned' ? responsibleUserId : undefined;
    createDeal.mutate(
      { dealType: newDealType, responsibleUserId: assignedUserId },
      { onSuccess: (result) => {
        setShowCreateDialog(false);
        setSelectedDealId(result.id);
        setResponsibleUserId('unassigned');

        // Send notification to assigned user (if not self)
        if (assignedUserId && assignedUserId !== user?.id) {
          addNotification({
            type: 'deal_assigned',
            title: `Deal Assigned to You`,
            message: `You have been assigned a new ${DEAL_TYPE_LABELS[newDealType]} deal`,
            entityId: result.id,
            targetUserId: assignedUserId,
          });
        }
      }}
    );
  };

  if (selectedDeal) {
    return (
      <DealDetailView
        deal={selectedDeal}
        clientId={clientId}
        onBack={() => setSelectedDealId(null)}
      />
    );
  }

  const getDealIcon = (type: DealType) => {
    switch (type) {
      case 'house_and_land': return <Home className="h-4 w-4 text-primary shrink-0" />;
      case 'refinance': return <RefreshCw className="h-4 w-4 text-primary shrink-0" />;
      default: return <Building2 className="h-4 w-4 text-primary shrink-0" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base sm:text-lg flex items-center gap-2">
          <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
          Deal Tracker
        </h3>
        <Button size="sm" onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          <span className="hidden sm:inline">New Deal</span>
          <span className="sm:hidden">New</span>
        </Button>
      </div>

      {deals.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-8 sm:py-12 text-center">
            <Building2 className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-1">No deals yet</p>
            <p className="text-xs text-muted-foreground mb-4">Create a deal to start tracking the property acquisition lifecycle.</p>
            <Button size="sm" onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Create First Deal
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {deals.map((deal) => {
            const riskConfig = RISK_STATUS_CONFIG[deal.risk_status];
            // Same derivation as the pipeline board and the portal — the
            // list can no longer disagree with the board about a deal.
            const journey = deriveDealJourney(deal);
            const completedStages = journey.completedStages;
            const totalStages = journey.totalStages;
            const progressPercent = journey.progressPct;

            return (
              <Card
                key={deal.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => setSelectedDealId(deal.id)}
              >
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                      {getDealIcon(deal.deal_type)}
                      <span className="font-medium text-xs sm:text-sm truncate">
                        {deal.property_address || DEAL_TYPE_LABELS[deal.deal_type]}
                      </span>
                      {journey.stageNumber != null && (
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          S{journey.stageNumber}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {deal.purchase_file_id && (
                        <Badge variant="outline" className="text-[10px] border-success/40 text-success">
                          🔗 Finance file
                        </Badge>
                      )}
                      <Badge className={cn('text-[10px] border shrink-0', riskConfig.color)}>
                        {riskConfig.emoji} {riskConfig.label}
                      </Badge>
                    </div>

                  </div>

                  <div className="mb-2 flex min-w-0 items-center gap-1.5">
                    <p className="min-w-0 truncate text-xs text-muted-foreground sm:text-sm">{journey.stageLabel}</p>
                    <Badge variant="outline" className="h-5 shrink-0 gap-1 text-[10px] font-normal text-muted-foreground">
                      <span aria-hidden>{journey.phase.icon}</span>
                      {journey.phase.label}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{completedStages}/{totalStages}</span>
                  </div>

                  {/* Key info - wrap on mobile */}
                  <div className="flex items-center gap-2 sm:gap-4 text-xs text-muted-foreground flex-wrap">
                    {deal.responsible_person && (() => {
                      const assignee = teamUsers.find(u => u.id === deal.responsible_person);
                      return <span className="truncate">👤 {assignee?.username || deal.responsible_person}</span>;
                    })()}
                    {deal.total_contract_price && (
                      <span>💰 {new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(deal.total_contract_price)}</span>
                    )}
                    {deal.deal_type === 'refinance' && deal.new_loan_amount && (
                      <span>🔁 {new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(deal.new_loan_amount)}</span>
                    )}
                    {deal.settlement_date && (
                      <span className="hidden sm:inline">📅 {format(new Date(deal.settlement_date), 'dd MMM yyyy')}</span>
                    )}
                    <span className="ml-auto text-[10px] sm:text-xs">{format(new Date(deal.created_at), 'dd MMM yyyy')}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Deal Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="w-[calc(100vw-24px)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Deal</DialogTitle>
            <DialogDescription>
              Choose the deal type to set up the appropriate tracking workflow.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-3 py-4">
            <Card
              className={cn(
                'cursor-pointer transition-all hover:border-primary/50',
                newDealType === 'existing_property' && 'border-primary ring-2 ring-primary/20'
              )}
              onClick={() => setNewDealType('existing_property')}
            >
              <CardContent className="flex flex-col items-center gap-2 p-3 sm:p-4 text-center">
                <Building2 className="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
                <span className="font-medium text-xs sm:text-sm">Existing Property</span>
                <span className="text-[10px] sm:text-xs text-muted-foreground">7-stage workflow</span>
              </CardContent>
            </Card>

            <Card
              className={cn(
                'cursor-pointer transition-all hover:border-primary/50',
                newDealType === 'house_and_land' && 'border-primary ring-2 ring-primary/20'
              )}
              onClick={() => setNewDealType('house_and_land')}
            >
              <CardContent className="flex flex-col items-center gap-2 p-3 sm:p-4 text-center">
                <Home className="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
                <span className="font-medium text-xs sm:text-sm">House & Land</span>
                <span className="text-[10px] sm:text-xs text-muted-foreground">7 land + 6 build</span>
              </CardContent>
            </Card>

            <Card
              className={cn(
                'cursor-pointer transition-all hover:border-primary/50',
                newDealType === 'refinance' && 'border-primary ring-2 ring-primary/20'
              )}
              onClick={() => setNewDealType('refinance')}
            >
              <CardContent className="flex flex-col items-center gap-2 p-3 sm:p-4 text-center">
                <RefreshCw className="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
                <span className="font-medium text-xs sm:text-sm">Refinance</span>
                <span className="text-[10px] sm:text-xs text-muted-foreground">12-stage workflow</span>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Assign Responsible Person</label>
            <TeamUserSelect
              value={responsibleUserId}
              onValueChange={setResponsibleUserId}
              placeholder="Assign team member..."
            />
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} className="w-full sm:w-auto">Cancel</Button>
            <Button onClick={handleCreate} disabled={createDeal.isPending} className="w-full sm:w-auto">
              {createDeal.isPending ? 'Creating...' : 'Create Deal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
