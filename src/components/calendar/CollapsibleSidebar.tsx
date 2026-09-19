import { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Pin, PinOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type SidebarTab = 'events' | 'availability' | 'templates' | 'heatmap' | 'analytics' | 'summary' | 'conflicts' | 'optimize' | 'overlay' | 'patterns' | 'reminders';

interface TabConfig {
  id: SidebarTab;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
}

interface CollapsibleSidebarProps {
  tabs: TabConfig[];
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  pinnedTabs: SidebarTab[];
  onTogglePin: (tab: SidebarTab) => void;
  smartOrderedTabs?: SidebarTab[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onQuickAdd: () => void;
  children: React.ReactNode;
}

export function CollapsibleSidebar({
  tabs,
  activeTab,
  onTabChange,
  pinnedTabs,
  onTogglePin,
  smartOrderedTabs,
  isCollapsed,
  onToggleCollapse,
  onQuickAdd,
  children,
}: CollapsibleSidebarProps) {
  // Order tabs: pinned first, then smart order, then rest
  const orderedTabs = useCallback(() => {
    const pinned = tabs.filter(t => pinnedTabs.includes(t.id));
    const unpinned = tabs.filter(t => !pinnedTabs.includes(t.id));
    
    if (smartOrderedTabs) {
      unpinned.sort((a, b) => {
        const aIndex = smartOrderedTabs.indexOf(a.id);
        const bIndex = smartOrderedTabs.indexOf(b.id);
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });
    }
    
    return [...pinned, ...unpinned];
  }, [tabs, pinnedTabs, smartOrderedTabs]);

  return (
    <Card className={cn(
      'transition-all duration-300 ease-in-out overflow-hidden',
      isCollapsed ? 'w-14' : 'w-full'
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between mb-2">
          {!isCollapsed && (
            <span className="text-xs font-medium text-muted-foreground">Tools</span>
          )}
          <div className="flex items-center gap-1 ml-auto">
            {!isCollapsed && (
              <Button 
                size="sm" 
                variant="outline" 
                className="h-7 text-xs"
                onClick={onQuickAdd}
              >
                Quick Add
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onToggleCollapse}
                >
                  {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <TooltipProvider delayDuration={100}>
          {isCollapsed ? (
            // Vertical icon-only tabs
            <div className="flex flex-col gap-1">
              {orderedTabs().map((tab) => (
                <Tooltip key={tab.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onTabChange(tab.id)}
                      className={cn(
                        'p-2 rounded-md transition-colors relative',
                        activeTab === tab.id 
                          ? 'bg-primary text-primary-foreground' 
                          : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {tab.icon}
                      {pinnedTabs.includes(tab.id) && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <div className="flex items-center gap-2">
                      {tab.label}
                      {tab.shortcut && (
                        <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded">{tab.shortcut}</kbd>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          ) : (
            // Horizontal tabs with shortcuts
            <Tabs value={activeTab} onValueChange={(v) => onTabChange(v as SidebarTab)}>
              <TabsList className="w-full flex flex-wrap h-auto gap-0.5 p-1">
                {orderedTabs().map((tab) => (
                  <Tooltip key={tab.id}>
                    <TooltipTrigger asChild>
                      <TabsTrigger 
                        value={tab.id} 
                        className={cn(
                          "text-xs px-0.5 relative group",
                          pinnedTabs.includes(tab.id) && "ring-1 ring-primary/30"
                        )}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onTogglePin(tab.id);
                        }}
                      >
                        {tab.icon}
                      </TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        {tab.label}
                        {tab.shortcut && (
                          <kbd className="px-1.5 py-0.5 text-[10px] bg-background/50 rounded border">{tab.shortcut}</kbd>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Right-click to {pinnedTabs.includes(tab.id) ? 'unpin' : 'pin'}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </TabsList>
            </Tabs>
          )}
        </TooltipProvider>
      </CardHeader>

      {!isCollapsed && (
        <CardContent className="p-3">
          {children}
        </CardContent>
      )}
    </Card>
  );
}
