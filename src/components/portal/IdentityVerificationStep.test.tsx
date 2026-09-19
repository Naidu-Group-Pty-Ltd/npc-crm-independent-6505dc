import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The Client Portal identity-verification step.
 *
 * These cover the two ways the electronic flow dead-ended in front of a
 * customer: a camera that never came back after Retake, and a capture step
 * offered on a case where the server would refuse the upload.
 */

const verificationStatus = vi.fn();
const startHostedVerification = vi.fn();
const submitVerification = vi.fn();
const prepareVerificationAttempt = vi.fn();
const submitVerificationAttempt = vi.fn();
vi.mock('@/lib/aml/amlPortalApi', () => ({
  amlPortalApi: {
    verificationStatus: (...a: unknown[]) => verificationStatus(...a),
    requestVerificationUpload: vi.fn(),
    submitVerification: (...a: unknown[]) => submitVerification(...a),
    startHostedVerification: (...a: unknown[]) => startHostedVerification(...a),
    prepareVerificationAttempt: (...a: unknown[]) => prepareVerificationAttempt(...a),
    submitVerificationAttempt: (...a: unknown[]) => submitVerificationAttempt(...a),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { IdentityVerificationStep } from './IdentityVerificationStep';

/**
 * Counts how many times the camera is opened, records the requested facing
 * mode, and hands back stoppable tracks.
 */
function mockCamera(opts: { fail?: boolean; dimensions?: [number, number] } = {}) {
  const stops: Array<() => void> = [];
  const facings: string[] = [];
  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    facings.push(String((constraints.video as MediaTrackConstraints)?.facingMode ?? ''));
    if (opts.fail) throw new DOMException('Permission denied', 'NotAllowedError');
    const stop = vi.fn();
    stops.push(stop);
    return { getTracks: () => [{ stop }] } as unknown as MediaStream;
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia }, configurable: true, writable: true,
  });
  // jsdom implements none of these, and the component must not depend on
  // play() resolving for the preview to become usable.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    value: vi.fn().mockResolvedValue(undefined), configurable: true, writable: true,
  });
  const [w, h] = opts.dimensions ?? [1280, 960];
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    get: () => w, configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    get: () => h, configurable: true,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    get: () => 1 /* HAVE_METADATA */, configurable: true,
  });
  return { getUserMedia, stops, facings };
}

/** Stand in for the canvas encoder jsdom does not implement. */
function stubCanvas(blob: Blob | null = new Blob(['jpeg'], { type: 'image/jpeg' })) {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as any;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(blob); } as any;
}

/**
 * A prepared attempt, as `prepare_verification_attempt` answers it.
 *
 * The server names all three objects; the browser is handed permissions to
 * write to them and nothing else. `document_back` is absent for a passport,
 * which is what makes the two-photo journey two photos.
 */
const preparedFor = (choice: 'passport' | 'driver_licence' = 'passport') => ({
  attempt_id: '11111111-1111-4111-8111-111111111111',
  required: {
    document_front: true as const,
    document_back: choice === 'driver_licence',
    selfie: true as const,
  },
  uploads: {
    document_front: { upload_url: 'https://storage.test/front', token: 't1' },
    ...(choice === 'driver_licence'
      ? { document_back: { upload_url: 'https://storage.test/back', token: 't2' } }
      : {}),
    selfie: { upload_url: 'https://storage.test/selfie', token: 't3' },
  },
  attempts_remaining: 3,
  max_attempts: 3,
});

/**
 * Walk from the party list to the first camera.
 *
 * The journey is deliberately longer than it used to be: choose a document,
 * read what to have ready, then Begin — which is where the server prepares the
 * attempt. The camera opens only after that returns, which is the whole point
 * (nothing is collected before the gate).
 *
 * `/^start$/` rather than `/start/`: the shoot button reads "Starting camera…"
 * until the stream is ready, and would otherwise match.
 */
async function openDialog(choice: RegExp = /passport/i) {
  fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));
  fireEvent.click(await screen.findByRole('radio', { name: choice }));
  fireEvent.click(await screen.findByRole('button', { name: /^continue$/i }));
  await act(async () => {
    fireEvent.click(await screen.findByRole('button', { name: /begin secure verification/i }));
  });
  // getUserMedia → play() → setReady is a promise chain; flush it inside act
  // so the ready-gated button has rendered before anything looks for it.
  await act(async () => { await Promise.resolve(); });
}

/** Walk to the selfie step, leaving the selfie camera open and ready. */
async function reachSelfieStep() {
  await openDialog();
  await act(async () => {
    fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
  });
  fireEvent.click(await screen.findByRole('button', { name: /use this photo/i }));
  // The front camera is acquired by an effect, and its shutter stays disabled
  // ("Starting camera…") until the stream reports dimensions. Flush that chain
  // so callers find a live shutter rather than the placeholder.
  await act(async () => { await Promise.resolve(); });
}

const party = {
  party_id: null, label: 'You', status: 'not_started' as const,
  attempts_used: 0, attempts_remaining: 3, can_attempt: true,
};

const status = (over: Record<string, unknown> = {}) => ({
  enabled: true, max_attempts: 3, biometric_consent_accepted: true,
  availability: 'available', parties: [party], ...over,
});

const noop = () => {};
const renderStep = () => render(
  <IdentityVerificationStep caseId="case-1" onBack={noop} onNext={noop} onNeedsConsent={noop} />,
);

beforeEach(() => {
  verificationStatus.mockReset();
  startHostedVerification.mockReset();
  submitVerification.mockReset();
  prepareVerificationAttempt.mockReset();
  submitVerificationAttempt.mockReset();
  prepareVerificationAttempt.mockResolvedValue(preparedFor('passport'));
  submitVerificationAttempt.mockResolvedValue({
    submitted: true, attempt_id: preparedFor().attempt_id, attempt_number: 1,
    attempts_remaining: 3, status: 'processing', message: 'received',
  });
  // The signed-URL PUT. Uploads go to NPC storage and nowhere else, so a test
  // that reaches the network has found a defect rather than a flake.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
  URL.createObjectURL = vi.fn(() => 'blob:capture');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('identity verification step', () => {
  it('reopens the camera after Retake', async () => {
    // The defect: Retake cleared the capture and re-rendered the preview, but
    // the acquisition effect keyed only on `facing`, which had not changed. It
    // never re-ran, the stream stopped by the previous shot was never
    // replaced, and the customer was left with a black preview and a dead
    // button — no way out but reloading the page.
    const camera = mockCamera();
    verificationStatus.mockResolvedValue(status());
    stubCanvas();

    renderStep();

    await openDialog();
    await waitFor(() => expect(camera.getUserMedia).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });
    const retake = await screen.findByRole('button', { name: /retake/i });
    expect(camera.stops[0], 'the shot should release the camera').toHaveBeenCalled();

    fireEvent.click(retake);
    await waitFor(() => expect(camera.getUserMedia).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: /take photo/i })).toBeTruthy();
  });

  it('restarts the rear camera for a document retake and the front camera for a selfie retake', async () => {
    const camera = mockCamera();
    verificationStatus.mockResolvedValue(status());
    stubCanvas();

    renderStep();

    await openDialog();
    await waitFor(() => expect(camera.facings).toEqual(['environment']));

    // Document retake reopens the environment-facing camera.
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });
    fireEvent.click(await screen.findByRole('button', { name: /retake/i }));
    await waitFor(() => expect(camera.facings).toEqual(['environment', 'environment']));

    // Advance to the selfie step, then retake there.
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });
    fireEvent.click(await screen.findByRole('button', { name: /use this photo/i }));
    await waitFor(() => expect(camera.facings).toEqual(['environment', 'environment', 'user']));

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });
    fireEvent.click(await screen.findByRole('button', { name: /retake/i }));
    await waitFor(() =>
      expect(camera.facings).toEqual(['environment', 'environment', 'user', 'user']));

    // Every stream opened along the way was stopped, so no duplicate remains.
    expect(camera.stops).toHaveLength(4);
    camera.stops.slice(0, 3).forEach((stop, i) =>
      expect(stop, `stream ${i} should be stopped`).toHaveBeenCalled());
  });

  it('stops the document camera when the selfie step opens', async () => {
    const camera = mockCamera();
    verificationStatus.mockResolvedValue(status());
    stubCanvas();

    renderStep();
    await reachSelfieStep();

    await waitFor(() => expect(camera.facings).toContain('user'));
    expect(camera.stops[0], 'the document stream must not stay open').toHaveBeenCalled();
  });

  it('stops every track when the check is cancelled', async () => {
    const camera = mockCamera();
    verificationStatus.mockResolvedValue(status());
    stubCanvas();

    renderStep();
    await openDialog();
    await waitFor(() => expect(camera.stops).toHaveLength(1));

    // Leaving the first capture is a cancel. The prepared attempt stays a
    // draft and nothing has been used up.
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^cancel$/i }));
    });
    await waitFor(() => expect(camera.stops[0]).toHaveBeenCalled());
  });

  it('will not take a photo before the video has real dimensions', async () => {
    // The blank-frame defect: a zero-height stream must not produce a capture.
    mockCamera({ dimensions: [1280, 0] });
    verificationStatus.mockResolvedValue(status());
    stubCanvas();

    renderStep();
    await openDialog();

    const shoot = await screen.findByRole('button', { name: /starting camera/i });
    expect((shoot as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a visible error when the customer denies camera permission', async () => {
    mockCamera({ fail: true });
    verificationStatus.mockResolvedValue(status());

    renderStep();
    await openDialog();

    expect(await screen.findByText(/could not open your camera/i)).toBeTruthy();
    // The manual file fallback stays available so they are not dead-ended.
    expect(await screen.findByText(/upload a photo from this device/i)).toBeTruthy();
  });

  it('shows a visible error when the capture cannot be encoded', async () => {
    // canvas.toBlob returning null used to be swallowed, so the button looked
    // inert and nothing told the customer anything had gone wrong.
    mockCamera();
    verificationStatus.mockResolvedValue(status());
    stubCanvas(null);

    renderStep();
    await openDialog();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });

    expect(await screen.findByText(/could not process the photo/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retake/i }), 'no capture was kept').toBeNull();
  });

  it('refuses a HEIC chosen from the photo library and says what to do instead', async () => {
    mockCamera();
    verificationStatus.mockResolvedValue(status());

    renderStep();
    await openDialog();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const heic = new File(['x'], 'IMG_4021.HEIC', { type: 'image/heic' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [heic] } });
    });

    expect(await screen.findByText(/HEIC photos cannot be checked/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retake/i }), 'nothing was captured').toBeNull();
  });

  it('does not offer capture when the server would refuse the upload', async () => {
    // Offering "Start" here is the contradiction the request router was fixed
    // to avoid: the selfie upload URL is gated on the same availability, so
    // the customer photographed their face and was refused afterwards.
    mockCamera();
    verificationStatus.mockResolvedValue(
      status({ availability: 'manual_verification_required' }));

    renderStep();

    // The documentary route is the route, not "nothing to do": the client is
    // sent to upload their document rather than told to wait for an adviser
    // who is in fact waiting on them.
    expect(await screen.findByText(/verify your identity from your documents/i)).toBeTruthy();
    expect(await screen.findByRole('button', { name: /upload identity document/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull();
  });

  it('says nothing has been used up when the check is only temporarily down', async () => {
    mockCamera();
    verificationStatus.mockResolvedValue(
      status({ availability: 'temporarily_unavailable' }));

    renderStep();

    expect(await screen.findByText(/nothing has been used up/i)).toBeTruthy();
    // Even a transient outage offers the working route rather than only a wait.
    expect(await screen.findByRole('button', { name: /upload identity document/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull();
  });

  it('still offers capture when a provider is available', async () => {
    mockCamera();
    verificationStatus.mockResolvedValue(status());

    renderStep();

    expect(await screen.findByRole('button', { name: /start/i })).toBeTruthy();
  });
});

/**
 * The NPC capture journey, end to end.
 *
 * The customer chooses a document, photographs it, photographs themselves, and
 * waits — without ever leaving this page. What these check is the shape of
 * that: how many photographs each document asks for, that nothing is collected
 * before the server has agreed, that a double tap buys one verification rather
 * than two, and that the customer is never shown anybody else's product.
 */
describe('the NPC capture journey', () => {
  it('asks a passport holder for two photographs, not three', async () => {
    const camera = mockCamera();
    verificationStatus.mockResolvedValue(status());
    stubCanvas();
    prepareVerificationAttempt.mockResolvedValue(preparedFor('passport'));

    renderStep();
    await openDialog(/passport/i);

    // Front, then straight to the selfie: there is no back to photograph and
    // asking for one is a dead end.
    expect(await screen.findByText(/photograph the front of your document/i)).toBeTruthy();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });
    fireEvent.click(await screen.findByRole('button', { name: /use this photo/i }));

    expect(await screen.findByText(/take a photo of yourself/i)).toBeTruthy();
    expect(screen.queryByText(/now photograph the back/i)).toBeNull();
    await waitFor(() => expect(camera.facings).toEqual(['environment', 'user']));
  });

  it('asks a driver licence holder for the back as well, in order', async () => {
    const camera = mockCamera();
    verificationStatus.mockResolvedValue(status());
    stubCanvas();
    prepareVerificationAttempt.mockResolvedValue(preparedFor('driver_licence'));

    renderStep();
    await openDialog(/driver licence/i);

    expect(await screen.findByText(/photograph the front of your document/i)).toBeTruthy();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });
    fireEvent.click(await screen.findByRole('button', { name: /use this photo/i }));

    expect(await screen.findByText(/now photograph the back/i)).toBeTruthy();
    // Still the rear camera for the second side.
    await waitFor(() => expect(camera.facings).toEqual(['environment', 'environment']));

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });
    fireEvent.click(await screen.findByRole('button', { name: /use this photo/i }));

    expect(await screen.findByText(/take a photo of yourself/i)).toBeTruthy();
    await waitFor(() =>
      expect(camera.facings).toEqual(['environment', 'environment', 'user']));
  });

  it('tells the customer how many photographs before the camera opens', async () => {
    mockCamera();
    verificationStatus.mockResolvedValue(status());

    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));
    fireEvent.click(await screen.findByRole('radio', { name: /driver licence/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^continue$/i }));

    expect(await screen.findByText(/three photos, on this page/i)).toBeTruthy();
    // And says plainly that nothing leaves the page — the promise this whole
    // architecture exists to keep.
    expect(await screen.findByText(/nothing opens a new window/i)).toBeTruthy();
    // Still nothing prepared and nothing collected.
    expect(prepareVerificationAttempt).not.toHaveBeenCalled();
  });

  it('prepares the attempt before the camera opens, and never after', async () => {
    const camera = mockCamera();
    verificationStatus.mockResolvedValue(status());

    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));
    fireEvent.click(await screen.findByRole('radio', { name: /passport/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^continue$/i }));

    // Reading the brief opens no camera.
    expect(camera.getUserMedia).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /begin secure verification/i }));
    });

    expect(prepareVerificationAttempt).toHaveBeenCalledWith('case-1', {
      party_id: null, party_label: 'You', document_type: 'passport',
    });
    // The document type is the ONLY thing the browser declares.
    const [, params] = prepareVerificationAttempt.mock.calls[0];
    expect(Object.keys(params).sort()).toEqual(['document_type', 'party_id', 'party_label']);
    await waitFor(() => expect(camera.getUserMedia).toHaveBeenCalledTimes(1));
  });

  it('collects nothing when the server refuses to prepare', async () => {
    const camera = mockCamera();
    verificationStatus.mockResolvedValue(status());
    prepareVerificationAttempt.mockRejectedValue(Object.assign(
      new Error('Verification is temporarily unavailable. Nothing has been used up.'),
      { code: 'temporarily_unavailable' },
    ));

    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));
    fireEvent.click(await screen.findByRole('radio', { name: /passport/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^continue$/i }));

    verificationStatus.mockResolvedValue(status({ availability: 'temporarily_unavailable' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /begin secure verification/i }));
    });

    // No camera was ever opened, so no photograph exists to have been wasted —
    // and the customer lands on the documentary route rather than a dead end.
    expect(camera.getUserMedia).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /upload identity document/i })).toBeTruthy();
  });

  it('uploads to the server-named locations and submits an attempt id alone', async () => {
    mockCamera();
    verificationStatus.mockResolvedValue(status());
    stubCanvas();

    renderStep();
    await reachSelfieStep();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /send securely/i }));
    });

    const puts = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(puts.map((c) => c[0]))
      .toEqual(['https://storage.test/front', 'https://storage.test/selfie']);
    for (const [, init] of puts) expect((init as RequestInit).method).toBe('PUT');

    // The submission carries the attempt id and nothing else — no path, no
    // status, no provider, no score.
    expect(submitVerificationAttempt)
      .toHaveBeenCalledWith('case-1', preparedFor().attempt_id);
    expect(submitVerificationAttempt.mock.calls[0]).toHaveLength(2);
  });

  it('double-tapping Send submits once, not twice', async () => {
    mockCamera();
    verificationStatus.mockResolvedValue(status());
    stubCanvas();

    renderStep();
    await reachSelfieStep();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });

    const send = await screen.findByRole('button', { name: /send securely/i });
    await act(async () => {
      fireEvent.click(send);
      fireEvent.click(send);
    });

    // Two paid verifications from one impatient customer is exactly what the
    // in-flight guard exists to prevent; the server refuses a second too.
    expect(submitVerificationAttempt).toHaveBeenCalledTimes(1);
  });

  it('shows the waiting state and lets the customer leave', async () => {
    mockCamera();
    verificationStatus.mockResolvedValue(status());
    stubCanvas();

    renderStep();
    await reachSelfieStep();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /send securely/i }));
    });

    // Once, in the live region. The card title stays neutral: a browser run
    // showed the state printed twice one line apart, which reads as a
    // rendering fault rather than as emphasis.
    expect(await screen.findByText(/checking your identity/i)).toBeTruthy();
    expect(await screen.findByText(/keep this page open, or come back later/i)).toBeTruthy();
    expect(await screen.findByRole('button', { name: /back to identity/i })).toBeTruthy();
  });

  it('lands a returning customer on the waiting state, not a fresh chooser', async () => {
    mockCamera();
    verificationStatus.mockResolvedValue(status({
      parties: [{ ...party, verification_in_progress: true }],
    }));

    renderStep();
    // A refresh loses every trace of the submission on this side. The server's
    // boolean is what stops the customer photographing everything again while
    // their first set is still with the provider.
    expect(await screen.findByRole('button', { name: /check progress/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /check progress/i }));
    await act(async () => { await Promise.resolve(); });

    expect(await screen.findByText(/checking your identity/i)).toBeTruthy();
    expect(screen.queryByText(/which identity document will you use/i)).toBeNull();
  });

  it('leaves the waiting state when the server says the check has settled', async () => {
    /*
     * The defect a browser found and jsdom did not.
     *
     * The sub-screen was handed the party as it stood when Start was pressed,
     * and that object never changed again. The polling worked, the server
     * settled, and the customer sat on "Checking your identity" for ever —
     * because nothing was reading the answer. The step now re-derives the live
     * party from the latest read on every render.
     */
    mockCamera();
    verificationStatus.mockResolvedValue(status({
      parties: [{ ...party, verification_in_progress: true }],
    }));
    stubCanvas();

    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /check progress/i }));
    await act(async () => { await Promise.resolve(); });
    expect(await screen.findByText(/checking your identity/i)).toBeTruthy();

    // The processor finishes. The next poll carries the settled party.
    verificationStatus.mockResolvedValue(status({
      parties: [{
        ...party, status: 'verified', can_attempt: false, verification_in_progress: false,
      }],
    }));

    await waitFor(
      async () => expect(await screen.findByText(/verification received/i)).toBeTruthy(),
      { timeout: 8000 },
    );
  }, 15000);

  it('opens the secure window synchronously, before the session request', async () => {
    /*
     * The ordering the hosted flow rests on, exercised rather than read.
     *
     * `window.open` must be called inside the customer's click and BEFORE the
     * session request resolves — a window opened after an `await` is an
     * unsolicited popup and is blocked on default settings in Safari and
     * Firefox. Asserted by holding the session request open: the window must
     * already exist while the promise is still pending.
     */
    mockCamera();
    const fakeWindow = { location: { replace: vi.fn() }, closed: false, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(fakeWindow as unknown as Window);
    verificationStatus.mockResolvedValue(status({ provider_flow: 'hosted' }));

    let release!: (v: unknown) => void;
    startHostedVerification.mockReturnValue(new Promise((r) => { release = r; }));

    renderStep();

    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));
    fireEvent.click(await screen.findByRole('radio', { name: /passport/i }));
    fireEvent.click(await screen.findByRole('button', { name: /continue/i }));
    fireEvent.click(await screen.findByRole('button', { name: /begin/i }));

    // The window exists while the session request is still in flight.
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(open.mock.calls[0][0], 'opened blank, then navigated').toBe('');
    expect(open.mock.calls[0][1], 'one named window').toBe('npc-identity-verification');
    expect(fakeWindow.location.replace).not.toHaveBeenCalled();

    release({ started: true, verification_url: 'https://verify.example/session/abc' });

    await waitFor(() => expect(fakeWindow.location.replace)
      .toHaveBeenCalledWith('https://verify.example/session/abc'));
    // Exactly one session was requested for one click.
    expect(startHostedVerification).toHaveBeenCalledTimes(1);
    // The provider is never framed inside NPC's own page.
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('recovers a blocked window in one press, without a second session', async () => {
    mockCamera();
    // The browser refuses the window: `window.open` returns null.
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    verificationStatus.mockResolvedValue(status({ provider_flow: 'hosted' }));
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: 'https://verify.example/session/abc',
    });

    renderStep();

    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));
    fireEvent.click(await screen.findByRole('radio', { name: /passport/i }));
    fireEvent.click(await screen.findByRole('button', { name: /continue/i }));
    fireEvent.click(await screen.findByRole('button', { name: /begin/i }));

    expect(await screen.findByText(/blocked the secure window/i)).toBeTruthy();
    // The session was created and nothing was used up — recovery is one press.
    expect(await screen.findByText(/nothing has been used up/i)).toBeTruthy();
    expect(startHostedVerification).toHaveBeenCalledTimes(1);

    open.mockReturnValue({ closed: false } as unknown as Window);
    fireEvent.click(screen.getByRole('button', { name: /open secure check/i }));

    // Re-opened from the URL held in memory: no second session was bought.
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(open.mock.calls[1][0]).toBe('https://verify.example/session/abc');
    expect(startHostedVerification).toHaveBeenCalledTimes(1);
  });

  it('never shows the customer a provider window, frame or brand', async () => {
    mockCamera();
    const open = vi.spyOn(window, 'open');
    verificationStatus.mockResolvedValue(status());
    stubCanvas();

    renderStep();
    await reachSelfieStep();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /send securely/i }));
    });

    expect(open).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
    expect(startHostedVerification).not.toHaveBeenCalled();
    expect(document.body.textContent?.toLowerCase()).not.toContain('didit');
  });
});

/**
 * The hosted secure-identity check: removed 2026-08-11, reactivated 2026-08-14.
 *
 * It was retired on a product decision — no customer reaches a verification
 * vendor's page — and `src/lib/aml/hostedIdvRetired.test.ts` held that as an
 * absence: no `window.open`, no iframe, no navigation, no way to ask for a
 * session. That suite is gone, because the hosted component exists again — but
 * the product decision it protected STANDS: no tenant resolves the hosted
 * provider, and the customer still uses NPC's own camera. The provider-side
 * record the business wanted comes from `save_api_request=true` on the
 * Standalone calls (Manual Checks), not from moving anybody off NPC.
 *
 * What guards the flow now is `src/lib/aml/hostedIdvSession.test.ts` plus the
 * two behavioural tests above — the popup ORDERING (open synchronously inside
 * the click, before the session request) and blocked-window recovery without a
 * second session. The properties that outlived the reversal are kept and are
 * asserted in `identityDocumentSession.test.ts`: no iframe, no credential in
 * the bundle, no session URL in storage or a log, and no path from any browser
 * event to a verification outcome.
 *
 * Hosted RESULTS were never in question — `diditDecision.test.ts`,
 * `diditWebhookSecurity.test.ts` and `diditSessionLifecycle.test.ts` cover
 * them, because a late signed outcome for a session that already ran must
 * still settle the canonical record.
 */

/* ── telling the page when canonical verification state moves ──────────── */

/**
 * This step keeps its own copy of the verification status; the journey that
 * draws the stepper, the overall progress figure and the review summary lives
 * on the page above it. They used to drift: a customer could finish a check,
 * come back, and find "Verify identity" still grey with the progress bar
 * unmoved until they reloaded the page by hand.
 *
 * The callback carries NO argument, and that is the contract. It says
 * something moved; the page answers by re-reading the server. Nothing the
 * browser works out can mark anybody verified.
 *
 * ## The loop these also guard
 *
 * The first version notified on the first read whenever that read was not
 * "quiet". A customer sitting on a check that was already `in_review`
 * therefore announced a change that had not happened; the page reloaded, the
 * reload blanked the portal, this component unmounted, its memory of what it
 * had seen died with it, and the remount made the same server state new
 * again — forever. The page blinked and could not be used.
 *
 * The first successful read for a case is a BASELINE, never a change. The
 * page loaded its overview from the same server; there is nothing to tell it.
 */
describe('parent refresh on canonical change', () => {
  const onStatusChange = vi.fn();
  const renderWithStatusChange = () => render(
    <IdentityVerificationStep
      caseId="case-1" onBack={noop} onNext={noop} onNeedsConsent={noop}
      onStatusChange={onStatusChange}
    />,
  );

  beforeEach(() => { onStatusChange.mockReset(); });

  it('stays quiet on the first read when nothing has been started', async () => {
    verificationStatus.mockResolvedValue(status());
    renderWithStatusChange();
    await screen.findByRole('button', { name: /^start$/i });
    // The page already assumes this state; an overview fetch here buys nothing.
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('stays quiet on the first read when a check is ALREADY in flight', async () => {
    // The production loop, in one assertion. `in_review` at mount is not news:
    // the page's own overview came from the same server, and announcing it
    // reloaded the page, which unmounted this component, which forgot it had
    // seen anything, which made the same state new again on remount.
    verificationStatus.mockResolvedValue(
      status({ parties: [{ ...party, status: 'in_review', can_attempt: false }] }));
    renderWithStatusChange();
    await screen.findByText(/with our team/i);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('stays quiet on the first read for every settled state', async () => {
    for (const partyStatus of ['verified', 'action_required', 'contact_adviser'] as const) {
      onStatusChange.mockReset();
      verificationStatus.mockResolvedValue(
        status({ parties: [{ ...party, status: partyStatus, can_attempt: false }] }));
      const view = renderWithStatusChange();
      await waitFor(() => expect(verificationStatus).toHaveBeenCalled());
      await act(async () => { await Promise.resolve(); });
      expect(onStatusChange).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('stays quiet when a hosted check is open at mount', async () => {
    verificationStatus.mockResolvedValue(status({
      parties: [{ ...party, status: 'not_started', verification_in_progress: true }],
    }));
    renderWithStatusChange();
    await waitFor(() => expect(verificationStatus).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('tells the page when the party state moves, and says nothing about what to', async () => {
    verificationStatus.mockResolvedValue(status());
    renderWithStatusChange();
    await screen.findByRole('button', { name: /^start$/i });
    expect(onStatusChange).not.toHaveBeenCalled();

    // The server has settled the party since the page loaded; the step's next
    // read is where it finds out.
    verificationStatus.mockResolvedValue(
      status({ parties: [{ ...party, status: 'verified', can_attempt: false }] }));
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1));
    // No outcome crosses the callback — the parent re-reads the server.
    for (const call of onStatusChange.mock.calls) expect(call).toHaveLength(0);
  });

  it('does not notify again while the state is unchanged', async () => {
    verificationStatus.mockResolvedValue(status());
    renderWithStatusChange();
    await screen.findByRole('button', { name: /^start$/i });

    // Same state read again — not news, whatever prompts the read.
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await act(async () => { await Promise.resolve(); });
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('takes a fresh baseline for a genuinely different case', async () => {
    verificationStatus.mockResolvedValue(status());
    const view = render(
      <IdentityVerificationStep
        caseId="case-1" onBack={noop} onNext={noop} onNeedsConsent={noop}
        onStatusChange={onStatusChange}
      />,
    );
    await screen.findByRole('button', { name: /^start$/i });

    // A different case, already in review. Its first read is its baseline —
    // not a change, even though it differs from the previous case's state.
    verificationStatus.mockResolvedValue(
      status({ parties: [{ ...party, status: 'in_review', can_attempt: false }] }));
    view.rerender(
      <IdentityVerificationStep
        caseId="case-2" onBack={noop} onNext={noop} onNeedsConsent={noop}
        onStatusChange={onStatusChange}
      />,
    );
    await screen.findByText(/with our team/i);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('an ordinary parent re-render does not make an unchanged state new', async () => {
    // The parent re-renders this component on every background refresh, with
    // fresh inline callback props. That must not be mistaken for a change —
    // it is the other half of what made the loop endless.
    verificationStatus.mockResolvedValue(
      status({ parties: [{ ...party, status: 'in_review', can_attempt: false }] }));
    const view = render(
      <IdentityVerificationStep
        caseId="case-1" onBack={noop} onNext={noop} onNeedsConsent={noop}
        onStatusChange={onStatusChange}
      />,
    );
    await screen.findByText(/with our team/i);

    for (let i = 0; i < 5; i++) {
      view.rerender(
        <IdentityVerificationStep
          caseId="case-1" onBack={() => {}} onNext={() => {}} onNeedsConsent={() => {}}
          onStatusChange={onStatusChange}
        />,
      );
      await act(async () => { await Promise.resolve(); });
    }
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('reports a change once, then goes quiet again on the same state', async () => {
    verificationStatus.mockResolvedValue(status());
    renderWithStatusChange();
    await screen.findByRole('button', { name: /^start$/i });

    verificationStatus.mockResolvedValue(
      status({ parties: [{ ...party, status: 'in_review', can_attempt: false }] }));
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1));

    // Re-rendering with new parent props must not make it look new again —
    // that is what turned one announcement into an endless one.
    await act(async () => { await Promise.resolve(); });
    expect(onStatusChange).toHaveBeenCalledTimes(1);
  });
});
