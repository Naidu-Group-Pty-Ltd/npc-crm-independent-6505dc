import * as React from 'react';
import { SidebarMenu, SidebarMenuItem, SidebarMenuSkeleton } from 'npc-property-dashboard-ui';

// NOTE: SidebarMenuSkeleton picks its bar width with Math.random(), so this
// preview is deliberately multi-row — a single row would look like an arbitrary
// stub. It also means the render is not byte-stable between builds.
//
// No SidebarProvider wrapper: SidebarMenu/SidebarMenuItem are plain ul/li and
// read no context, and the provider's min-h-svh wrapper would stretch the card.
export const Loading = () => (
  <div style={{ width: 240 }} className="rounded-md border border-border p-2">
    <SidebarMenu>
      {[0, 1, 2, 3, 4].map((i) => (
        <SidebarMenuItem key={i}>
          <SidebarMenuSkeleton />
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  </div>
);

export const WithIcon = () => (
  <div style={{ width: 240 }} className="rounded-md border border-border p-2">
    <SidebarMenu>
      {[0, 1, 2, 3].map((i) => (
        <SidebarMenuItem key={i}>
          <SidebarMenuSkeleton showIcon />
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  </div>
);
