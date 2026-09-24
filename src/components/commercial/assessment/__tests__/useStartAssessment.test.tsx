/**
 * "New assessment" creates the draft on the click and opens its Type step.
 *
 * It asked first for a while: a dialog took the name, the type, the building
 * and the client, and created nothing until it was confirmed. That dialog is
 * gone, and these pin what the click does in its place:
 *
 *  - it creates exactly one draft and opens it on the Type step, where the
 *    name and the transaction type are asked;
 *  - started from a building, the draft carries it (named after it, filled
 *    from it, typed by what it is), read from its own register;
 *  - a building that cannot be read creates nothing, because the click asked
 *    for an assessment OF it;
 *  - a double-click cannot mint two drafts;
 *  - a failed create opens nothing and says why.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const createAssessment = vi.fn();
const toast = vi.fn();
const getCommercial = vi.fn();
const getIndustrial = vi.fn();

vi.mock('@/lib/ciAssessment/assessmentManagement', () => ({
  createAssessment: (...args: unknown[]) => createAssessment(...args),
}));
vi.mock('@/hooks/use-toast', () => ({ toast: (...args: unknown[]) => toast(...args) }));
vi.mock('@/hooks/useCommercialProperties', () => ({
  commercialApi: { getProperty: (...args: unknown[]) => getCommercial(...args) },
}));
vi.mock('@/hooks/useIndustrialProperties', () => ({
  industrialApi: { getProperty: (...args: unknown[]) => getIndustrial(...args) },
}));

const { useStartAssessment, startKey } = await import('../useStartAssessment');
type StartFrom = Parameters<typeof startKey>[0];

const PROPERTY_ID = '6b0f4c1e-9a55-4e3c-9c1b-2f6f1d2b7a10';
const INDUSTRIAL_BUILDING = {
  id: PROPERTY_ID, user_id: 'u1', address: '45 Industrial Drive', suburb: 'Wetherill Park', state: 'NSW',
  postcode: '2164', asset_class: 'industrial', tenure: 'freehold', gst_treatment: 'going_concern',
  purchase_price: 6_100_000, nla_sqm: 4_200, site_area_sqm: 8_000, outgoings_recoverable: {},
  industrial_specs: {}, created_at: '', updated_at: '',
};
const WAREHOUSE = {
  id: 'w1', user_id: 'u1', property_name: null, street: '12 Freight Road', suburb: 'Erskine Park', state: 'NSW',
  postcode: '2759', asset_subtype: 'warehouse', purchase_price: 4_000_000, gla_sqm: 3_000, site_area_sqm: 6_000,
  status: 'active', created_at: '', updated_at: '',
};

function Landed() {
  const location = useLocation();
  return <p data-testid="landed">{`${location.pathname}${location.search}`}</p>;
}

function Starter({ from }: { from?: StartFrom }) {
  const { start, starting } = useStartAssessment();
  return (
    <>
      <button type="button" onClick={() => void start(from)}>New assessment</button>
      <output data-testid="starting">{starting ?? ''}</output>
    </>
  );
}

function renderStarter(from?: StartFrom) {
  return render(
    <MemoryRouter initialEntries={['/commercial']}>
      <Routes>
        <Route path="/commercial" element={<Starter from={from} />} />
        <Route path="*" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
}

const click = () => fireEvent.click(screen.getByRole('button', { name: /new assessment/i }));

beforeEach(() => {
  createAssessment.mockReset().mockResolvedValue({ data: { id: 'new-1' }, error: null });
  toast.mockReset();
  getCommercial.mockReset().mockResolvedValue({ data: INDUSTRIAL_BUILDING, error: null });
  getIndustrial.mockReset().mockResolvedValue({ data: WAREHOUSE, error: null });
});

afterEach(cleanup);

describe('New assessment', () => {
  it('creates the draft on the click and opens it on its Type step', async () => {
    renderStarter();
    click();

    await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent('/commercial/assessments/new-1?step=type'));
    expect(createAssessment).toHaveBeenCalledTimes(1);
    const input = createAssessment.mock.calls[0][0];
    expect(input).toMatchObject({
      title: 'Untitled assessment',
      assessmentType: 'commercial_investment',
      segment: 'commercial',
    });
    expect(input.payload.assessmentType).toBe('commercial_investment');
    // Who it is for is chosen inside the assessment now: nothing is recorded
    // about a client on the click.
    expect(input).not.toHaveProperty('intendedClientId');
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Assessment created' }));
  });

  it('starts an assessment OF a building: named after it, filled from it, typed by what it is', async () => {
    renderStarter({ domain: 'commercial', propertyId: PROPERTY_ID });
    click();

    await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent('/commercial/assessments/new-1?step=type'));
    expect(getCommercial).toHaveBeenCalledWith(PROPERTY_ID);
    expect(getIndustrial).not.toHaveBeenCalled();
    const input = createAssessment.mock.calls[0][0];
    expect(input.assessmentType).toBe('industrial_investment');
    expect(input.segment).toBe('industrial');
    expect(input.title).toBe('45 Industrial Drive — industrial investment');
    expect(input.payload.property.address).toBe('45 Industrial Drive');
    expect(input.payload.property.purchasePrice).toBe(6_100_000);
    expect(input.payload.property.registerProperty).toMatchObject({ domain: 'commercial', propertyId: PROPERTY_ID });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Assessment created',
      description: expect.stringMatching(/filled from the property register/),
    }));
  });

  it('reads a building from its own register', async () => {
    renderStarter({ domain: 'industrial', propertyId: 'w1' });
    click();

    await waitFor(() => expect(createAssessment).toHaveBeenCalledTimes(1));
    expect(getIndustrial).toHaveBeenCalledWith('w1');
    expect(getCommercial).not.toHaveBeenCalled();
    const input = createAssessment.mock.calls[0][0];
    expect(input.segment).toBe('industrial');
    expect(input.payload.property.registerProperty).toMatchObject({ domain: 'industrial', propertyId: 'w1' });
  });

  it('creates nothing when the building cannot be read, and says so', async () => {
    getCommercial.mockResolvedValue({ data: null, error: { message: 'Network unavailable' } });
    renderStarter({ domain: 'commercial', propertyId: PROPERTY_ID });
    click();

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Could not start the assessment',
      description: expect.stringMatching(/nothing was created\. Network unavailable/),
      variant: 'destructive',
    })));
    expect(createAssessment).not.toHaveBeenCalled();
    expect(screen.queryByTestId('landed')).toBeNull();
    // The button is free again for a retry.
    expect(screen.getByTestId('starting')).toHaveTextContent('');
  });

  it('treats a building the register no longer has as unreadable, not as no building', async () => {
    getCommercial.mockResolvedValue({ data: null, error: null });
    renderStarter({ domain: 'commercial', propertyId: PROPERTY_ID });
    click();

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringMatching(/no longer in your register/),
    })));
    expect(createAssessment).not.toHaveBeenCalled();
  });

  it('makes one draft however many times it is clicked while creating', async () => {
    let finish: (value: unknown) => void = () => {};
    createAssessment.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderStarter();
    click();
    click();
    click();

    // Says which start is under way, so the button pressed can show it.
    await waitFor(() => expect(screen.getByTestId('starting')).toHaveTextContent('blank'));
    expect(createAssessment).toHaveBeenCalledTimes(1);

    finish({ data: { id: 'new-1' }, error: null });
    await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent('/commercial/assessments/new-1?step=type'));
    expect(createAssessment).toHaveBeenCalledTimes(1);
  });

  it('names the building a start is for, so only its row says so', async () => {
    let finish: (value: unknown) => void = () => {};
    createAssessment.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderStarter({ domain: 'commercial', propertyId: PROPERTY_ID });
    click();

    await waitFor(() => expect(screen.getByTestId('starting')).toHaveTextContent(`commercial:${PROPERTY_ID}`));
    expect(startKey({ domain: 'commercial', propertyId: PROPERTY_ID })).toBe(`commercial:${PROPERTY_ID}`);
    expect(startKey(null)).toBe('blank');
    finish({ data: { id: 'new-1' }, error: null });
    await waitFor(() => expect(screen.getByTestId('landed')).toBeInTheDocument());
  });

  it('opens nothing when the create fails, and shows the server’s reason', async () => {
    createAssessment.mockResolvedValue({ data: null, error: 'Your role cannot create assessments.' });
    renderStarter();
    click();

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Could not create the assessment',
      description: 'Your role cannot create assessments.',
      variant: 'destructive',
    })));
    expect(screen.queryByTestId('landed')).toBeNull();
    expect(screen.getByTestId('starting')).toHaveTextContent('');
  });
});
