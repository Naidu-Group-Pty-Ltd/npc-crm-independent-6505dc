/**
 * Every link that ever pointed at `/calculators` still lands somewhere useful.
 *
 * The analysis workspace behind that route was a second editor for the same
 * assessment records. It is retired, and these are the bookmarks: each one a
 * shape of link that exists in the wild — the workspace's own canonical link,
 * a stage deep link, a property page's "Send to Calculators", the landing
 * page's "Standalone calculators" — and where it has to land now.
 */

import { describe, expect, it } from 'vitest';
import {
  legacyCalculatorRedirect, readNewAssessmentLink, withoutNewAssessmentLink,
} from '../legacyCalculatorLinks';
import { workspacePath } from '../workspaceBootstrap';

const at = (search: string) => {
  const params = new URLSearchParams(search);
  return legacyCalculatorRedirect({
    workspace: params.get('workspace'),
    stage: params.get('stage'),
    domain: params.get('domain'),
    propertyId: params.get('propertyId'),
  });
};

describe('an analysis link opens the same record in the assessment', () => {
  it('opens the assessment itself', () => {
    expect(at('workspace=a1')).toBe('/commercial/assessments/a1');
  });

  it('opens the step that now holds the same fields', () => {
    const cases: Array<[string, string]> = [
      ['context', 'type'], ['property', 'property'], ['income', 'lease'], ['ownership', 'ownership'],
      ['lending', 'loan'], ['valuation', 'analysis'], ['forecast', 'analysis'],
      ['results', 'results'], ['report', 'results'],
    ];
    for (const [stage, step] of cases) {
      expect(at(`workspace=a1&stage=${stage}`), stage).toBe(`/commercial/assessments/a1?step=${step}`);
    }
  });

  it('honours the canonical link the workspace itself handed out', () => {
    const link = workspacePath('a1', 'forecast');
    expect(at(link.split('?')[1])).toBe('/commercial/assessments/a1?step=analysis');
  });

  it('ignores a stage it does not recognise rather than inventing a step', () => {
    expect(at('workspace=a1&stage=nonsense')).toBe('/commercial/assessments/a1');
  });
});

describe('a property link lands on that building, one click from a new assessment', () => {
  it('keeps the domain, so an industrial property opens from its own register', () => {
    expect(at('domain=industrial&propertyId=p1')).toBe('/industrial/p1');
    expect(at('domain=commercial&propertyId=p1')).toBe('/commercial/p1');
  });

  it('reads an unknown domain as commercial', () => {
    expect(at('domain=retail&propertyId=p1')).toBe('/commercial/p1');
  });

  it('creates nothing on arrival: a link is not a request for a record', () => {
    // The old page minted an "Untitled analysis" on every "Send to
    // Calculators" click, and a link is followed again by every refresh and
    // bookmark. A redirect is a PATH, never a creation, and the building's
    // page is where "New assessment" starts one of it.
    expect(at('domain=commercial&propertyId=p1')).not.toContain('new=');
  });
});

describe('everything else lands on the assessment list', () => {
  it('the old "Standalone calculators" button and bare visits', () => {
    expect(at('domain=commercial')).toBe('/commercial?tab=assessments');
    expect(at('domain=industrial')).toBe('/commercial?tab=assessments');
    expect(at('')).toBe('/commercial?tab=assessments');
  });
});

describe('the landing reads a "New assessment" link already out there', () => {
  const read = (path: string) => readNewAssessmentLink(new URL(path, 'https://app.test').searchParams);

  it('reads the link the landing used to write, building and all', () => {
    expect(read('/commercial?tab=assessments&new=assessment')).toEqual({ property: null });
    expect(read('/commercial?tab=assessments&new=assessment&domain=industrial&propertyId=p1')).toEqual({
      property: { domain: 'industrial', propertyId: 'p1' },
    });
  });

  it('is null when the URL is not one', () => {
    expect(read('/commercial?tab=assessments')).toBeNull();
    expect(read('/commercial?new=something-else&propertyId=p1')).toBeNull();
  });

  it('names no building rather than guessing a register it does not have', () => {
    expect(read('/commercial?new=assessment&domain=retail&propertyId=p1')).toEqual({ property: null });
    expect(read('/commercial?new=assessment&domain=commercial&propertyId=%20')).toEqual({ property: null });
  });

  it('clears the request and keeps everything else', () => {
    const params = new URL('/commercial?tab=assessments&new=assessment&domain=commercial&propertyId=p1', 'https://app.test').searchParams;
    expect(withoutNewAssessmentLink(params).toString()).toBe('tab=assessments');
    // The input is not modified — the router owns it.
    expect(params.get('new')).toBe('assessment');
  });
});
