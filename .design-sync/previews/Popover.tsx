import * as React from 'react';
import {
  Button,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'npc-property-dashboard-ui';

export const Open = () => (
  <Popover open>
    <PopoverTrigger asChild>
      <Button variant="outline">Filter pipeline</Button>
    </PopoverTrigger>
    <PopoverContent>
      <div style={{ display: 'grid', gap: 10 }}>
        <Label>Settlement window</Label>
        <p className="text-muted-foreground" style={{ margin: 0, fontSize: 13 }}>
          Showing matters settling between 1 August and 30 September 2026.
        </p>
      </div>
    </PopoverContent>
  </Popover>
);

export const Closed = () => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline">Open filters</Button>
    </PopoverTrigger>
    <PopoverContent>Filters</PopoverContent>
  </Popover>
);
