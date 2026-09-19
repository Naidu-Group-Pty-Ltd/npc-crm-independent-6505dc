import * as React from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from 'npc-property-dashboard-ui';

export const Single = () => (
  <Accordion type="single" collapsible defaultValue="item-1" style={{ width: 460 }}>
    <AccordionItem value="item-1">
      <AccordionTrigger>What is included in the settlement statement?</AccordionTrigger>
      <AccordionContent>
        Adjustments for council rates, water and strata levies, plus transfer duty and any agreed
        vendor contributions.
      </AccordionContent>
    </AccordionItem>
    <AccordionItem value="item-2">
      <AccordionTrigger>When is transfer duty payable?</AccordionTrigger>
      <AccordionContent>
        In NSW, within three months of the contract date, or at settlement if that comes first.
      </AccordionContent>
    </AccordionItem>
    <AccordionItem value="item-3">
      <AccordionTrigger>Can the cooling-off period be waived?</AccordionTrigger>
      <AccordionContent>Yes, with a s66W certificate from the purchaser's solicitor.</AccordionContent>
    </AccordionItem>
  </Accordion>
);

export const Multiple = () => (
  <Accordion type="multiple" defaultValue={['a', 'b']} style={{ width: 460 }}>
    <AccordionItem value="a">
      <AccordionTrigger>Identity documents</AccordionTrigger>
      <AccordionContent>Passport and driver licence received 22 July.</AccordionContent>
    </AccordionItem>
    <AccordionItem value="b">
      <AccordionTrigger>Financial documents</AccordionTrigger>
      <AccordionContent>Three months of statements received; payslips outstanding.</AccordionContent>
    </AccordionItem>
  </Accordion>
);
