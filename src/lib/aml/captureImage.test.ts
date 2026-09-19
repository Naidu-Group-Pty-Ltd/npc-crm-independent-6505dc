import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  frameToJpeg, isUnsupportedCaptureFormat, toUploadableJpeg, UnreadableCaptureError,
} from './captureImage';

/**
 * Capture normalisation.
 *
 * Both behaviours here exist because of something that reached the
 * verification service and came back as a failure the customer had no way to
 * understand: a blank frame, and a HEIC photo OpenCV cannot decode.
 */

afterEach(() => { vi.unstubAllGlobals(); });

describe('capturing a camera frame', () => {
  it('refuses a frame the camera has not filled in yet', async () => {
    // `play()` resolving does not mean there are pixels. Shooting at that
    // moment produced a blank 1×1 JPEG that uploaded successfully and came
    // back "no face found" — a capture failure disguised as a result.
    const video = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;
    await expect(frameToJpeg(video)).rejects.toBeInstanceOf(UnreadableCaptureError);
    await expect(frameToJpeg(video)).rejects.toThrow(/camera was not ready/i);
  });

  it('refuses a frame with a width but no height', async () => {
    const video = { videoWidth: 1280, videoHeight: 0 } as HTMLVideoElement;
    await expect(frameToJpeg(video)).rejects.toBeInstanceOf(UnreadableCaptureError);
  });
});

describe('rejecting formats OpenCV cannot read', () => {
  it('detects HEIC and HEIF by MIME type', () => {
    for (const type of [
      'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence',
      'IMAGE/HEIC', ' image/heic ',
    ]) {
      expect(isUnsupportedCaptureFormat({ type }), type).toBe(true);
    }
  });

  it('detects HEIC and HEIF by filename when the browser reports no type', () => {
    // iOS often hands over an empty or generic type, so the name is the only
    // signal available.
    for (const name of ['IMG_4021.HEIC', 'photo.heif', 'scan.hif', 'IMG_1.heic']) {
      expect(isUnsupportedCaptureFormat({ type: '', name }), name).toBe(true);
      expect(isUnsupportedCaptureFormat({ type: 'application/octet-stream', name }), name).toBe(true);
    }
  });

  it('leaves JPEG and PNG supported', () => {
    for (const f of [
      { type: 'image/jpeg', name: 'licence.jpg' },
      { type: 'image/png', name: 'licence.png' },
      { type: 'image/jpeg', name: 'holiday-in-heicberg.jpg' },
    ]) {
      expect(isUnsupportedCaptureFormat(f), f.name).toBe(false);
    }
  });

  it('refuses a HEIC before any upload, with instructions the customer can follow', async () => {
    // Nothing is submitted, so no attempt is consumed and no identity outcome
    // is recorded — the failure mode this replaces was a 400 from the service
    // that surfaced as "With our team" and never asked for another photo.
    const heic = Object.assign(new Blob(['x'], { type: 'image/heic' }), { name: 'IMG_4021.HEIC' });
    await expect(toUploadableJpeg(heic as File)).rejects.toBeInstanceOf(UnreadableCaptureError);
    await expect(toUploadableJpeg(heic as File)).rejects.toThrow(/JPEG or PNG/i);
  });

  it('refuses a HEIC even when the browser claims it could decode it', async () => {
    // Safari decodes HEIC, so createImageBitmap would succeed — and the result
    // would still be an image OpenCV never sees, because we would have to send
    // it as JPEG anyway. Reject on format, not on decodability.
    vi.stubGlobal('createImageBitmap', vi.fn());
    const heic = Object.assign(new Blob(['x'], { type: '' }), { name: 'IMG_4021.HEIC' });
    await expect(toUploadableJpeg(heic as File)).rejects.toBeInstanceOf(UnreadableCaptureError);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
});

describe('normalising a file the customer picked', () => {
  it('passes a JPEG through when the browser cannot re-encode', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const jpeg = new Blob(['x'], { type: 'image/jpeg' });
    await expect(toUploadableJpeg(jpeg)).resolves.toBe(jpeg);
  });

  it('refuses a non-JPEG when the browser cannot re-encode, rather than sending it', async () => {
    // Uploading a HEIC under `Content-Type: image/jpeg` is how an iPhone
    // library photo reached OpenCV, returned a 400, and left the client on
    // "With our team" having done nothing wrong.
    vi.stubGlobal('createImageBitmap', undefined);
    for (const type of ['image/heic', 'image/png', 'image/webp', '']) {
      await expect(
        toUploadableJpeg(new Blob(['x'], { type })), `type=${type}`,
      ).rejects.toBeInstanceOf(UnreadableCaptureError);
    }
  });

  it('says something the customer can act on when the image will not decode', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));
    await expect(toUploadableJpeg(new Blob(['x'], { type: 'image/heic' })))
      .rejects.toThrow(/take a new photo|JPEG or PNG/i);
  });
});
