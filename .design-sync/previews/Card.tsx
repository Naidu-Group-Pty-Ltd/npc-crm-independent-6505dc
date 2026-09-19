import * as React from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from 'npc-property-dashboard-ui';

export const PropertySummary = () => (
  <Card style={{ maxWidth: 420 }}>
    <CardHeader>
      <CardTitle>14 Marlborough Street, Balmain NSW 2041</CardTitle>
      <CardDescription>Established dwelling · 3 bed · 2 bath · 1 car</CardDescription>
    </CardHeader>
    <CardContent>
      <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 8, margin: 0 }}>
        <dt className="text-muted-foreground">Purchase price</dt>
        <dd style={{ margin: 0, fontWeight: 600 }}>$1,845,000</dd>
        <dt className="text-muted-foreground">Loan amount</dt>
        <dd style={{ margin: 0, fontWeight: 600 }}>$1,383,750</dd>
        <dt className="text-muted-foreground">LVR</dt>
        <dd style={{ margin: 0, fontWeight: 600 }}>75.0%</dd>
        <dt className="text-muted-foreground">Settlement</dt>
        <dd style={{ margin: 0, fontWeight: 600 }}>12 Sep 2026</dd>
      </dl>
    </CardContent>
    <CardFooter style={{ gap: 8 }}>
      <Button size="sm">Open file</Button>
      <Button size="sm" variant="outline">
        Valuation report
      </Button>
    </CardFooter>
  </Card>
);

export const WithStatus = () => (
  <Card style={{ maxWidth: 420 }}>
    <CardHeader>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <CardTitle>Compliance review</CardTitle>
          <CardDescription>AML/CTF verification for Harding Family Trust</CardDescription>
        </div>
        <Badge variant="warning">Pending</Badge>
      </div>
    </CardHeader>
    <CardContent>
      <p style={{ margin: 0 }} className="text-muted-foreground">
        Two of four beneficial owners have completed identity verification. Outstanding documents were
        requested on 28 July and are due before settlement.
      </p>
    </CardContent>
  </Card>
);

export const Metric = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
    <Card>
      <CardHeader style={{ paddingBottom: 8 }}>
        <CardDescription>Settlements this month</CardDescription>
        <CardTitle style={{ fontSize: 30 }}>27</CardTitle>
      </CardHeader>
      <CardContent>
        <span className="text-muted-foreground" style={{ fontSize: 13 }}>
          +4 on June
        </span>
      </CardContent>
    </Card>
    <Card>
      <CardHeader style={{ paddingBottom: 8 }}>
        <CardDescription>Funds under management</CardDescription>
        <CardTitle style={{ fontSize: 30 }}>$48.2m</CardTitle>
      </CardHeader>
      <CardContent>
        <span className="text-muted-foreground" style={{ fontSize: 13 }}>
          Across 312 active files
        </span>
      </CardContent>
    </Card>
    <Card>
      <CardHeader style={{ paddingBottom: 8 }}>
        <CardDescription>Average LVR</CardDescription>
        <CardTitle style={{ fontSize: 30 }}>71.4%</CardTitle>
      </CardHeader>
      <CardContent>
        <span className="text-muted-foreground" style={{ fontSize: 13 }}>
          Target ≤ 80%
        </span>
      </CardContent>
    </Card>
  </div>
);
