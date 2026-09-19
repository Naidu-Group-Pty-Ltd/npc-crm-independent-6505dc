import * as React from 'react';
import { Label, Switch } from 'npc-property-dashboard-ui';

export const States = () => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
    <Switch aria-label="Off" />
    <Switch defaultChecked aria-label="On" />
    <Switch disabled aria-label="Disabled off" />
    <Switch disabled defaultChecked aria-label="Disabled on" />
  </div>
);

export const SettingsRow = () => (
  <div style={{ display: 'grid', gap: 16, width: 380 }}>
    {[
      ['notify-settlement', 'Settlement reminders', 'Email the file owner 7 days out', true],
      ['notify-market', 'Market update digest', 'Weekly summary of licensed sources', false],
    ].map(([id, title, desc, on]) => (
      <div key={id as string} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <Label htmlFor={id as string}>{title as string}</Label>
          <p className="text-muted-foreground" style={{ margin: '2px 0 0', fontSize: 13 }}>
            {desc as string}
          </p>
        </div>
        <Switch id={id as string} defaultChecked={on as boolean} />
      </div>
    ))}
  </div>
);
