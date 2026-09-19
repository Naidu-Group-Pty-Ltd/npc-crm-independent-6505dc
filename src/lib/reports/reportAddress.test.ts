import { describe, expect, it } from 'vitest';
import { resolveReportAddress } from './reportAddress';

describe('resolveReportAddress', () => {
  it('keeps complete Australian addresses unchanged', () => {
    expect(resolveReportAddress({ property_address: '7 Isis Court, Cooloola Cove QLD 4580' }))
      .toBe('7 Isis Court, Cooloola Cove QLD 4580');
  });

  it('recovers a full address from a labelled report cover', () => {
    expect(resolveReportAddress({
      property_address: '22 Shiraz Street',
      report_content: '**Property:** 22 Shiraz Street, Muswellbrook NSW 2333',
    })).toBe('22 Shiraz Street, Muswellbrook NSW 2333');
  });

  it('recovers locality from a multiline subject-property block', () => {
    expect(resolveReportAddress({
      property_address: '28 Bligh Street',
      report_content: '**Subject Property:**  \n28 Bligh Street, Muswellbrook NSW 2333  \nProperty type: House',
    })).toBe('28 Bligh Street, Muswellbrook NSW 2333');
  });

  it('does not attach an unrelated locality to the stored street', () => {
    expect(resolveReportAddress({
      property_address: '16 Queen Street',
      report_content: 'Comparable sale: 4 Other Road, Sydney NSW 2000',
    })).toBe('16 Queen Street');
  });
});