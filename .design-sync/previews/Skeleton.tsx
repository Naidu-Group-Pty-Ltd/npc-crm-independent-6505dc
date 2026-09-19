import * as React from 'react';
import { Skeleton } from 'npc-property-dashboard-ui';

export const Shapes = () => (
  <div style={{ display: 'grid', gap: 12, width: 340 }}>
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-3/4" />
    <Skeleton className="h-10 w-10 rounded-full" />
  </div>
);

export const CardPlaceholder = () => (
  <div
    style={{ width: 340, display: 'grid', gap: 12, padding: 16 }}
    className="rounded-lg border border-border"
  >
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Skeleton className="h-10 w-10 rounded-full" />
      <div style={{ display: 'grid', gap: 6, flex: 1 }}>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
    <Skeleton className="h-24 w-full" />
  </div>
);

export const TableRows = () => (
  <div style={{ display: 'grid', gap: 10, width: 340 }}>
    {[0, 1, 2, 3].map((i) => (
      <div key={i} style={{ display: 'flex', gap: 12 }}>
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-4 w-1/4" />
      </div>
    ))}
  </div>
);
