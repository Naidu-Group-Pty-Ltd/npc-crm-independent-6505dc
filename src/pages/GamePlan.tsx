import { useState } from 'react';
import { useGamePlans, useGamePlanMutations } from '@/hooks/useGamePlans';
import { useAssignedTasks } from '@/hooks/useAssignedTasks';
import { GamePlanList } from '@/components/gameplan/GamePlanList';
import { GamePlanDetail } from '@/components/gameplan/GamePlanDetail';
import { CreatePlanDialog } from '@/components/gameplan/CreatePlanDialog';
import { AssignedTasksTab } from '@/components/gameplan/AssignedTasksTab';
import { Button } from '@/components/ui/button';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Map, ListChecks, Sparkles } from 'lucide-react';
import { useModulePermissions } from '@/hooks/useModulePermissions';

export default function GamePlan() {
  const { data: plans = [], isLoading } = useGamePlans();
  const { data: assignedTasks = [] } = useAssignedTasks();
  const { plans: planMut } = useGamePlanMutations();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [activeTab, setActiveTab] = useState('plans');
  const { canEdit, canDelete } = useModulePermissions('game_plans');

  const selectedPlan = plans.find(p => p.id === selectedPlanId);

  // Count outstanding (non-completed) assigned tasks for badge
  const outstandingCount = assignedTasks.filter(t => t.status !== 'completed').length;

  if (selectedPlan) {
    return <GamePlanDetail plan={selectedPlan} onBack={() => setSelectedPlanId(null)} />;
  }

  return (
    <DashboardThemeFrame
      as="main"
      variant="page"
      className="relative min-h-0 space-y-6 overflow-hidden rounded-[1.75rem] border border-border/60 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.14),transparent_34%),linear-gradient(180deg,hsl(var(--background)/0.98),hsl(var(--muted)/0.18)_48%,hsl(var(--background)/0.96))] p-3 shadow-2xl shadow-sm dark:shadow-black/10 dark:border-white/10 dark:bg-background/85 dark:shadow-black/35 sm:p-5 lg:p-6"
    >
      {/* Header */}
      <DashboardThemeFrame
        as="header"
        variant="hero"
        className="flex flex-col gap-5 border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.86)_50%,hsl(var(--primary)/0.13))] p-4 shadow-xl shadow-sm dark:shadow-black/10 dark:shadow-black/30 sm:p-5 lg:flex-row lg:items-center lg:justify-between lg:p-6"
      >
        <div className="flex min-w-0 items-start gap-4">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(var(--primary)/0.64))] shadow-lg shadow-primary/20 ring-1 ring-border dark:ring-white/35 dark:ring-white/10 sm:h-14 sm:w-14">
            <Map className="h-6 w-6 text-primary-foreground" />
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-background bg-card text-primary shadow-sm">
              <Sparkles className="h-3 w-3" />
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Game Plans</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">Strategic playbooks for your team</p>
          </div>
        </div>
        {canEdit && activeTab === 'plans' && (
          <Button
            onClick={() => setShowCreate(true)}
            aria-label="Create a new game plan"
            className="h-11 w-full gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/25 focus-visible:ring-primary/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:w-auto"
          >
            <Plus className="h-4 w-4" /> New Game Plan
          </Button>
        )}
      </DashboardThemeFrame>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0 space-y-4">
        <DashboardThemeFrame
          variant="toolbar"
          className="overflow-x-auto rounded-2xl border-primary/15 bg-card/65 p-1.5 shadow-inner shadow-sm dark:shadow-black/5 dark:bg-background/45 dark:shadow-black/20"
        >
          <TabsList className="grid h-auto w-full min-w-max grid-cols-2 gap-1 bg-transparent p-0 sm:min-w-0 md:w-auto">
            <TabsTrigger
              value="plans"
              className="min-h-10 gap-1.5 rounded-xl border border-transparent px-4 py-2 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:border-primary/20 hover:bg-primary/5 hover:text-foreground focus-visible:ring-primary/40 motion-reduce:transition-none data-[state=active]:border-primary/25 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-primary/20"
            >
              <Map className="h-4 w-4" />
              Game Plans
            </TabsTrigger>
            <TabsTrigger
              value="assigned"
              className="min-h-10 gap-1.5 rounded-xl border border-transparent px-4 py-2 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:border-primary/20 hover:bg-primary/5 hover:text-foreground focus-visible:ring-primary/40 motion-reduce:transition-none data-[state=active]:border-primary/25 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-primary/20"
            >
              <ListChecks className="h-4 w-4" />
              Assigned Tasks
              {outstandingCount > 0 && (
                <Badge
                  variant="outline"
                  className="ml-1 h-5 min-w-[20px] rounded-full border-primary/30 bg-primary/10 px-1.5 text-[10px] font-bold text-primary shadow-sm"
                >
                  {outstandingCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </DashboardThemeFrame>

        <TabsContent value="plans" className="mt-0 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <DashboardThemeFrame
            as="section"
            variant="section"
            className="border-primary/10 bg-card/55 p-3 shadow-xl shadow-sm dark:shadow-black/5 dark:bg-background/35 dark:shadow-black/20 sm:p-4 md:p-5"
          >
            <GamePlanList
              plans={plans}
              isLoading={isLoading}
              onSelect={setSelectedPlanId}
              onDelete={canDelete ? (id) => planMut.remove.mutateAsync(id) : undefined}
            />
          </DashboardThemeFrame>
        </TabsContent>

        <TabsContent value="assigned" className="mt-0 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <DashboardThemeFrame
            as="section"
            variant="section"
            className="border-primary/10 bg-card/55 p-3 shadow-xl shadow-sm dark:shadow-black/5 dark:bg-background/35 dark:shadow-black/20 sm:p-4 md:p-5"
          >
            <AssignedTasksTab />
          </DashboardThemeFrame>
        </TabsContent>
      </Tabs>

      {canEdit && (
        <CreatePlanDialog
          open={showCreate}
          onOpenChange={setShowCreate}
          onCreate={async (data) => {
            await planMut.create.mutateAsync(data);
            setShowCreate(false);
          }}
        />
      )}
    </DashboardThemeFrame>
  );
}
