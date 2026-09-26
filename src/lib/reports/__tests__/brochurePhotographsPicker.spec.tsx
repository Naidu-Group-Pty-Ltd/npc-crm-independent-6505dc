/**
 * The adviser confirms the brochure's photographs before the report is made:
 * what the picker says, what a tick does, and what the hook behind it keeps.
 *
 * The rules of the offer are pinned in `brochurePhotographs.spec.ts`; this is
 * what a person sees of them. Two things matter most. The first ticked
 * photograph is the cover, and the picker says so where the adviser is
 * looking. And every reason a brochure offers or suggests nothing is SAID,
 * because each sends the adviser somewhere different.
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrochurePhotographsPicker } from '@/components/reports/BrochurePhotographsPicker';
import { brochureFilingArgs, useBrochurePhotographs } from '@/hooks/useBrochurePhotographs';
import type { BrochureCandidate, BrochureOffer } from '../brochurePhotographs.pure';
import type { BrochureReading } from '../brochurePhotographs';
import { REPORT_FLOOR_PLAN_LIMIT, REPORT_PHOTOGRAPH_LIMIT } from '../../../../supabase/functions/_shared/reportPhotographs.pure';

const candidate = (key: string, pages: number[] = [1]): BrochureCandidate => ({
  key,
  width: 1600,
  height: 1000,
  kind: 'photo',
  signature: '0123456789abcdef',
  pages,
  shareByPage: Object.fromEntries(pages.map((page) => [page, 0.3])),
  tiled: false,
});

const offerOf = (keys: string[], overrides: Partial<BrochureOffer> = {}): BrochureOffer => ({
  offered: keys.map((key, index) => candidate(key, [index + 1])),
  lead: keys[0] ?? null,
  multiProperty: false,
  namesProperty: true,
  plans: [],
  leftOut: { notPhotographs: 0, furniture: 0, otherProperties: 0, unnamedPages: 0, overLimit: 0 },
  ...overrides,
});

const previewsOf = (keys: string[]) => new Map(keys.map((key) => [key, `blob:preview-${key}`]));

describe('what the picker says', () => {
  it('says it is reading, and that nothing was readable, in plain words', () => {
    const { rerender } = render(
      <BrochurePhotographsPicker status="reading" offer={null} previews={new Map()} selected={new Set()} onSelectedChange={() => {}} addressUsable />,
    );
    expect(screen.getByText(/Reading the brochure's photographs/)).toBeInTheDocument();
    rerender(
      <BrochurePhotographsPicker status="failed" offer={null} previews={new Map()} selected={new Set()} onSelectedChange={() => {}} addressUsable />,
    );
    expect(screen.getByText(/couldn't be read, so the report will be made without photographs/)).toBeInTheDocument();
  });

  it('offers nothing where the brochure\'s address cannot vouch for one property, and says why', () => {
    render(
      <BrochurePhotographsPicker status="ready" offer={offerOf(['a'])} previews={previewsOf(['a'])} selected={new Set(['a'])} onSelectedChange={() => {}} addressUsable={false} />,
    );
    expect(screen.getByText(/no street and suburb, so its photographs can't be tied to this property/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('shows each offered photograph with where it is in the brochure, and marks the first ticked one as the cover', () => {
    render(
      <BrochurePhotographsPicker status="ready" offer={offerOf(['a', 'b', 'c'])} previews={previewsOf(['a', 'b', 'c'])} selected={new Set(['c', 'b'])} onSelectedChange={() => {}} addressUsable />,
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('img', { name: 'Photograph from the brochure, page 1' })).toHaveAttribute('src', 'blob:preview-a');
    expect(screen.getByText(/The first is its cover/)).toBeInTheDocument();
    const covers = screen.getAllByText('Cover');
    expect(covers).toHaveLength(1);
    // `b` is offered before `c`, so `b` is the first ticked and the cover.
    expect(covers[0].closest('label')).toHaveAttribute('for', 'brochure-photograph-b');
  });

  it('says why pictures the adviser can see in the brochure are not offered', () => {
    const { rerender } = render(
      <BrochurePhotographsPicker
        status="ready"
        offer={offerOf(['a'], { leftOut: { notPhotographs: 2, furniture: 0, otherProperties: 0, unnamedPages: 5, overLimit: 0 } })}
        previews={previewsOf(['a'])}
        selected={new Set(['a'])}
        onSelectedChange={() => {}}
        addressUsable
      />,
    );
    expect(screen.getByText(/Pictures on pages that don't name this address aren't shown, because nothing ties them to this property/)).toBeInTheDocument();
    expect(screen.getByText(/Logos and other graphics aren't used/)).toBeInTheDocument();
    rerender(
      <BrochurePhotographsPicker
        status="ready"
        offer={offerOf(['a'], { multiProperty: true, leftOut: { notPhotographs: 0, furniture: 0, otherProperties: 3, unnamedPages: 1, overLimit: 0 } })}
        previews={previewsOf(['a'])}
        selected={new Set(['a'])}
        onSelectedChange={() => {}}
        addressUsable
      />,
    );
    expect(screen.getByText(/covers other lots too. Only pictures from pages naming this one are shown/)).toBeInTheDocument();
    expect(screen.queryByText(/Pictures on pages that don't name this address/)).toBeNull();
  });

  it('offers nothing, and says why, where no page of the brochure names this address', () => {
    render(
      <BrochurePhotographsPicker
        status="ready"
        offer={offerOf([], { lead: null, namesProperty: false, leftOut: { notPhotographs: 0, furniture: 0, otherProperties: 0, unnamedPages: 4, overLimit: 0 } })}
        previews={new Map()}
        selected={new Set()}
        onSelectedChange={() => {}}
        addressUsable
      />,
    );
    expect(screen.getByText(/No page of the brochure names this address, so none of its pictures can be tied to this property/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('says when the pages naming this address hold no photograph or plan of it', () => {
    render(
      <BrochurePhotographsPicker status="ready" offer={offerOf([], { lead: null })} previews={new Map()} selected={new Set()} onSelectedChange={() => {}} addressUsable />,
    );
    expect(screen.getByText(/The pages naming this address carry no photograph or floor plan of it/)).toBeInTheDocument();
  });
});

const planOf = (key: string, page: number): BrochureCandidate => ({ ...candidate(key, [page]), kind: 'floorplan', width: 1199, height: 751 });

describe('the floor plan, beside the photographs', () => {
  it('shows the plan whole, says it is printed on a page of its own, and ticks it from the plan or its box', () => {
    const changes: Array<string[]> = [];
    render(
      <BrochurePhotographsPicker
        status="ready"
        offer={offerOf(['facade'], { plans: [planOf('plan', 1)] })}
        previews={previewsOf(['facade', 'plan'])}
        selected={new Set(['facade'])}
        onSelectedChange={() => {}}
        selectedPlans={new Set()}
        onSelectedPlansChange={(next) => changes.push([...next])}
        addressUsable
      />,
    );
    expect(screen.getByText('Floor plan')).toBeInTheDocument();
    expect(screen.getByText(/printed whole, on a page of its own/)).toBeInTheDocument();
    const image = screen.getByRole('img', { name: 'Floor plan from the brochure, page 1' });
    // Contained, never cropped, in the picker as on the page.
    expect(image.className).toContain('object-contain');
    expect(image.className).not.toContain('object-cover');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use the floor plan from page 1' }));
    expect(changes).toEqual([['plan']]);
    // A plan is never the cover.
    expect(screen.getAllByText('Cover')[0].closest('label')).toHaveAttribute('for', 'brochure-photograph-facade');
  });

  it('offers the plan where the property\'s pages carry no photograph', () => {
    render(
      <BrochurePhotographsPicker
        status="ready"
        offer={offerOf([], { lead: null, plans: [planOf('plan', 1)] })}
        previews={previewsOf(['plan'])}
        selected={new Set()}
        onSelectedChange={() => {}}
        selectedPlans={new Set(['plan'])}
        addressUsable
      />,
    );
    expect(screen.getByText(/The pages naming this address carry no photograph of it/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Use the floor plan from page 1' })).toBeChecked();
  });

  it('stops at the plans a report carries, and says so', () => {
    const plans = [planOf('a', 1), planOf('b', 2), planOf('c', 3)];
    const onSelectedPlansChange = vi.fn();
    render(
      <BrochurePhotographsPicker
        status="ready"
        offer={offerOf([], { lead: null, plans })}
        previews={previewsOf(['a', 'b', 'c'])}
        selected={new Set()}
        onSelectedChange={() => {}}
        selectedPlans={new Set(['a', 'b'])}
        onSelectedPlansChange={onSelectedPlansChange}
        addressUsable
      />,
    );
    const third = screen.getByRole('checkbox', { name: 'Use the floor plan from page 3' });
    expect(third).toBeDisabled();
    fireEvent.click(third);
    expect(onSelectedPlansChange).not.toHaveBeenCalled();
    expect(screen.getByText(`A report carries up to ${REPORT_FLOOR_PLAN_LIMIT} floor plans.`)).toBeInTheDocument();
  });
});

describe('what a tick does', () => {
  it('ticks and unticks one photograph, from the checkbox or the picture', () => {
    const changes: Array<string[]> = [];
    render(
      <BrochurePhotographsPicker status="ready" offer={offerOf(['a', 'b'])} previews={previewsOf(['a', 'b'])} selected={new Set(['a'])} onSelectedChange={(next) => changes.push([...next])} addressUsable />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use the photograph from page 2' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use the photograph from page 1' }));
    fireEvent.click(screen.getByRole('img', { name: 'Photograph from the brochure, page 2' }));
    expect(changes).toEqual([['a', 'b'], [], ['a', 'b']]);
  });

  it('stops at what a report can carry, and says so', () => {
    const keys = Array.from({ length: REPORT_PHOTOGRAPH_LIMIT + 1 }, (_, index) => `p${index}`);
    const selected = new Set(keys.slice(0, REPORT_PHOTOGRAPH_LIMIT));
    const onSelectedChange = vi.fn();
    render(
      <BrochurePhotographsPicker status="ready" offer={offerOf(keys)} previews={previewsOf(keys)} selected={selected} onSelectedChange={onSelectedChange} addressUsable />,
    );
    const last = screen.getByRole('checkbox', { name: `Use the photograph from page ${REPORT_PHOTOGRAPH_LIMIT + 1}` });
    expect(last).toBeDisabled();
    fireEvent.click(last);
    expect(onSelectedChange).not.toHaveBeenCalled();
    expect(screen.getByText(`A report carries up to ${REPORT_PHOTOGRAPH_LIMIT} photographs.`)).toBeInTheDocument();
  });
});

const reading = (keys: string[], texts: string[] = ['Lot 12 Smith Street, Box Hill']): BrochureReading => ({
  documentSha256: 'b'.repeat(64),
  pageCount: texts.length,
  pagesRead: texts.length,
  pageTexts: texts,
  candidates: keys.map((key) => candidate(key, [1])),
  files: new Map(keys.map((key) => [key, { blob: new Blob([key], { type: 'image/jpeg' }), width: 1600, height: 1000 }])),
});

describe('what the hook behind the picker keeps', () => {
  let created: string[];
  let revoked: string[];

  beforeEach(() => {
    created = [];
    revoked = [];
    let serial = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const url = `blob:test-${serial++}`;
      created.push(url);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => { revoked.push(url); });
  });

  afterEach(() => vi.restoreAllMocks());

  it('reads the brochure beside the parse, then suggests the lead once the parse names the property', async () => {
    const read = vi.fn(async () => reading(['facade', 'interior']));
    const { result } = renderHook(() => useBrochurePhotographs(read));
    act(() => result.current.begin(new File(['%PDF'], 'brochure.pdf')));
    expect(result.current.state).toBeNull();
    act(() => result.current.settle({ address: 'Lot 12 Smith Street', suburb: 'Box Hill' }));
    expect(result.current.state?.status).toBe('reading');
    await waitFor(() => expect(result.current.state?.status).toBe('ready'));
    expect(result.current.state?.selected).toEqual(new Set(['facade']));
    expect(result.current.state?.previews.size).toBe(2);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('ticks nothing where the brochure\'s address cannot vouch for one property', async () => {
    const { result } = renderHook(() => useBrochurePhotographs(async () => reading(['facade'])));
    act(() => result.current.begin(new File(['%PDF'], 'brochure.pdf')));
    act(() => result.current.settle({ address: 'Lot 12 Smith Street', suburb: null }));
    await waitFor(() => expect(result.current.state?.status).toBe('ready'));
    expect(result.current.state?.source).toBeNull();
    expect(result.current.state?.selected.size).toBe(0);
    expect(brochureFilingArgs(result.current.state)).toBeNull();
  });

  it('drops a reading a later brochure has superseded, however late it arrives', async () => {
    let finishFirst: (value: BrochureReading) => void = () => {};
    const first = new Promise<BrochureReading>((resolve) => { finishFirst = resolve; });
    const read = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => reading(['second']));
    const { result } = renderHook(() => useBrochurePhotographs(read));
    act(() => result.current.begin(new File(['%PDF'], 'one.pdf')));
    act(() => result.current.settle({ address: 'Lot 12 Smith Street', suburb: 'Box Hill' }));
    act(() => result.current.begin(new File(['%PDF'], 'two.pdf')));
    act(() => result.current.settle({ address: 'Lot 12 Smith Street', suburb: 'Box Hill' }));
    await waitFor(() => expect(result.current.state?.status).toBe('ready'));
    await act(async () => { finishFirst(reading(['first'])); await first; });
    expect([...(result.current.state?.selected ?? [])]).toEqual(['second']);
  });

  it('says it failed rather than showing nothing, when the brochure cannot be read', async () => {
    const { result } = renderHook(() => useBrochurePhotographs(async () => { throw new Error('not a PDF'); }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    act(() => result.current.begin(new File(['x'], 'brochure.pdf')));
    act(() => result.current.settle({ address: 'Lot 12 Smith Street', suburb: 'Box Hill' }));
    await waitFor(() => expect(result.current.state?.status).toBe('failed'));
  });

  it('ticks the property\'s floor plans as it ticks the lead, and hands them over to file', async () => {
    const withPlan: BrochureReading = {
      ...reading(['facade']),
      candidates: [candidate('facade', [1]), { ...candidate('plan', [1]), kind: 'floorplan' }],
      files: new Map([
        ['facade', { blob: new Blob(['f'], { type: 'image/jpeg' }), width: 1600, height: 1000 }],
        ['plan', { blob: new Blob(['p'], { type: 'image/png' }), width: 1199, height: 751 }],
      ]),
    };
    const { result } = renderHook(() => useBrochurePhotographs(async () => withPlan));
    act(() => result.current.begin(new File(['%PDF'], 'brochure.pdf')));
    act(() => result.current.settle({ address: 'Lot 12 Smith Street', suburb: 'Box Hill' }));
    await waitFor(() => expect(result.current.state?.status).toBe('ready'));
    expect(result.current.state?.selectedPlans).toEqual(new Set(['plan']));
    const args = result.current.filingArgs();
    expect(args?.plans.map((plan) => plan.key)).toEqual(['plan']);
    expect(args?.tickedPlans).toEqual(new Set(['plan']));
    // A plan alone is still something to file.
    act(() => result.current.setSelected(new Set()));
    await waitFor(() => expect(result.current.filingArgs()?.ticked.size).toBe(0));
    expect(result.current.filingArgs()?.tickedPlans).toEqual(new Set(['plan']));
  });

  it('hands over what to file only while something is ticked, and revokes every preview it made', async () => {
    const { result, unmount } = renderHook(() => useBrochurePhotographs(async () => reading(['facade', 'interior'])));
    act(() => result.current.begin(new File(['%PDF'], 'brochure.pdf')));
    act(() => result.current.settle({ address: 'Lot 12 Smith Street', suburb: 'Box Hill' }));
    await waitFor(() => expect(result.current.state?.status).toBe('ready'));
    const args = result.current.filingArgs();
    expect(args?.ticked).toEqual(new Set(['facade']));
    expect(args?.source).toEqual({ address: 'Lot 12 Smith Street', suburb: 'Box Hill' });
    expect(args?.documentSha256).toBe('b'.repeat(64));
    act(() => result.current.setSelected(new Set()));
    await waitFor(() => expect(result.current.filingArgs()).toBeNull());
    act(() => result.current.reset());
    expect(result.current.state).toBeNull();
    expect(revoked.sort()).toEqual(created.sort());
    unmount();
  });
});
