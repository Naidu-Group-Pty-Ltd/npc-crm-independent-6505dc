import * as React from 'react';
import { Progress } from 'npc-property-dashboard-ui';

export const Values = () => (
  <div style={{ width: 340, display: 'grid', gap: 14 }}>
    <Progress value={0} />
    <Progress value={35} />
    <Progress value={75} />
    <Progress value={100} />
  </div>
);

export const Labelled = () => (
  <div style={{ width: 340, display: 'grid', gap: 8 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
      <span>Document collection</span>
      <span style={{ fontWeight: 600 }}>6 of 8</span>
    </div>
    <Progress value={75} />
    <span className="text-muted-foreground" style={{ fontSize: 13 }}>
      Outstanding: council rates notice, strata report
    </span>
  </div>
);

export const Thin = () => (
  <div style={{ width: 340 }}>
    <Progress value={62} className="h-1.5" />
  </div>
);
