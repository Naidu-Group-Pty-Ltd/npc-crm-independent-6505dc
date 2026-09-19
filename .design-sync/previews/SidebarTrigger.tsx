import * as React from 'react';
import { SidebarTrigger } from 'npc-property-dashboard-ui';

// No SidebarProvider here on purpose. Its wrapper carries min-h-svh and does not
// forward className to that element, so wrapping stretches the preview card to
// the full viewport. useSidebar() outside a provider logs a warning and returns
// defaults, so the button still renders exactly as it does in the app.
export const Default = () => <SidebarTrigger />;

export const InHeader = () => (
  <header
    className="rounded-md border border-border"
    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', width: 420 }}
  >
    <SidebarTrigger />
    <span style={{ fontWeight: 600 }}>Matters</span>
    <span className="text-muted-foreground" style={{ marginLeft: 'auto', fontSize: 13 }}>
      312 active
    </span>
  </header>
);
