import * as React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'npc-property-dashboard-ui';

export const Default = () => (
  <Tabs defaultValue="overview" style={{ width: 460 }}>
    <TabsList>
      <TabsTrigger value="overview">Overview</TabsTrigger>
      <TabsTrigger value="documents">Documents</TabsTrigger>
      <TabsTrigger value="compliance">Compliance</TabsTrigger>
    </TabsList>
    <TabsContent value="overview">
      <p className="text-muted-foreground" style={{ marginTop: 12 }}>
        Purchase of 14 Marlborough Street, Balmain NSW 2041. Unconditional as of 24 July, settling
        12 September 2026.
      </p>
    </TabsContent>
    <TabsContent value="documents">
      <p className="text-muted-foreground" style={{ marginTop: 12 }}>
        6 of 8 documents received.
      </p>
    </TabsContent>
  </Tabs>
);

export const ManyTabs = () => (
  <Tabs defaultValue="valuation" style={{ width: 560 }}>
    <TabsList>
      <TabsTrigger value="valuation">Valuation</TabsTrigger>
      <TabsTrigger value="lending">Lending</TabsTrigger>
      <TabsTrigger value="legal">Legal</TabsTrigger>
      <TabsTrigger value="aml">AML</TabsTrigger>
      <TabsTrigger value="notes">Notes</TabsTrigger>
    </TabsList>
    <TabsContent value="valuation">
      <p className="text-muted-foreground" style={{ marginTop: 12 }}>
        Valuation received 30 July — $1,820,000 against a $1,845,000 contract price.
      </p>
    </TabsContent>
  </Tabs>
);

export const Disabled = () => (
  <Tabs defaultValue="active" style={{ width: 400 }}>
    <TabsList>
      <TabsTrigger value="active">Active</TabsTrigger>
      <TabsTrigger value="archived" disabled>
        Archived
      </TabsTrigger>
    </TabsList>
    <TabsContent value="active">
      <p className="text-muted-foreground" style={{ marginTop: 12 }}>
        312 active files.
      </p>
    </TabsContent>
  </Tabs>
);
