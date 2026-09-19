import * as React from 'react';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from 'npc-property-dashboard-ui';

// A bare ellipsis glyph on its own reads as nothing — the truthful render is
// inside the trail it collapses.
export const InTrail = () => (
  <Breadcrumb>
    <BreadcrumbList>
      <BreadcrumbItem>
        <BreadcrumbLink href="#">Dashboard</BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator />
      <BreadcrumbItem>
        <BreadcrumbEllipsis />
      </BreadcrumbItem>
      <BreadcrumbSeparator />
      <BreadcrumbItem>
        <BreadcrumbPage>NPC-2841</BreadcrumbPage>
      </BreadcrumbItem>
    </BreadcrumbList>
  </Breadcrumb>
);

export const Standalone = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <span className="text-muted-foreground" style={{ fontSize: 13 }}>
      collapsed segments →
    </span>
    <BreadcrumbEllipsis />
  </div>
);
