import * as React from 'react';
import {
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from 'npc-property-dashboard-ui';

export const Default = () => (
  <div style={{ width: 280 }}>
    <Select defaultValue="nsw">
      <SelectTrigger>
        <SelectValue placeholder="Select a state" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="nsw">New South Wales</SelectItem>
        <SelectItem value="vic">Victoria</SelectItem>
        <SelectItem value="qld">Queensland</SelectItem>
        <SelectItem value="wa">Western Australia</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const WithLabel = () => (
  <div style={{ width: 280, display: 'grid', gap: 6 }}>
    <Label htmlFor="loan-purpose">Loan purpose</Label>
    <Select defaultValue="investment">
      <SelectTrigger id="loan-purpose">
        <SelectValue placeholder="Select a purpose" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Residential</SelectLabel>
          <SelectItem value="owner-occupied">Owner occupied</SelectItem>
          <SelectItem value="investment">Investment</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Commercial</SelectLabel>
          <SelectItem value="industrial">Industrial</SelectItem>
          <SelectItem value="retail">Retail</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

export const Placeholder = () => (
  <div style={{ width: 280 }}>
    <Select>
      <SelectTrigger>
        <SelectValue placeholder="Assign a solicitor…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">Priya Nandakumar</SelectItem>
        <SelectItem value="b">Tom Whitfield</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const Disabled = () => (
  <div style={{ width: 280 }}>
    <Select disabled defaultValue="locked">
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="locked">Locked after settlement</SelectItem>
      </SelectContent>
    </Select>
  </div>
);
