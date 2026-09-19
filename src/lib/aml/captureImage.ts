/**
 * Normalising an identity capture into something the verification service can
 * actually read.
 *
 * The portal uploads captures to a signed URL with `Content-Type: image/jpeg`
 * and the verification service decodes them with OpenCV. Both assumptions hold
 * for a canvas capture and break for the file-picker fallback, which accepts
 * `image/*`:
 *
 *  - an iPhone photo picked from the library is HEIC. OpenCV cannot decode it,
 *    so the service answers 400, the worker records a technical failure, and
 *    the client sits on "With our team" having done nothing wrong;
 *  - a PNG or WebP decodes fine but is stored under a content type it is not,
 *    which makes the biometric object misleading in the very bucket whose
 *    every read is audited;
 *  - a 12 MP phone photo is several megabytes of base64 through an edge
 *    function, for an image the service immediately downscales to 2000px.
 *
 * So every capture — camera or file — goes through here and comes out as JPEG
 * within the service's own working bound. Re-encoding is done on a canvas,
 * which also strips EXIF, including the GPS tag a phone photo often carries.
 * We have no purpose for a customer's location (APP 3), so not collecting it
 * is better than holding it.
 */

/** Matches the service's own downscale bound (`decode_image` in main.py). */
export const MAX_CAPTURE_EDGE_PX = 2000;

/** JPEG quality for re-encoded captures — high enough for a face embedding. */
const JPEG_QUALITY = 0.92;

export class UnreadableCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnreadableCaptureError';
  }
}

function drawToJpeg(
  source: CanvasImageSource, width: number, height: number,
): Promise<Blob> {
  const scale = Math.min(1, MAX_CAPTURE_EDGE_PX / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new UnreadableCaptureError('This browser could not process the photo.');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob
        ? resolve(blob)
        : reject(new UnreadableCaptureError('This browser could not process the photo.')),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

/** Capture a video frame as an upload-ready JPEG. Rejects a frame with no dimensions. */
export async function frameToJpeg(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  // A zero-dimension frame yields a blank JPEG that uploads and comes back
  // "no face found" — a capture failure disguised as a result. Both dimensions
  // are checked: a stream can report a width before it reports a height.
  if (!width || !height) {
    throw new UnreadableCaptureError('The camera was not ready. Please try again.');
  }
  return drawToJpeg(video, width, height);
}

/**
 * Formats the verification service cannot read.
 *
 * OpenCV decodes neither HEIC nor HEIF, and an iPhone photo chosen from the
 * library is HEIC by default. Uploading one under `Content-Type: image/jpeg`
 * is how a customer who had done nothing wrong ended up on "With our team":
 * the service answered 400, the worker recorded a technical failure, and
 * nothing in the portal ever asked them for a different photo.
 *
 * Rejecting here, before any upload, is the only point at which we can tell
 * them something useful. Nothing is submitted, so no attempt is consumed and
 * no identity outcome is recorded.
 */
const UNSUPPORTED_MIME = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
const UNSUPPORTED_EXTENSIONS = ['.heic', '.heif', '.hif'];

/** iOS sometimes reports an empty or generic type, so the name is checked too. */
export function isUnsupportedCaptureFormat(file: { type?: string; name?: string }): boolean {
  const type = (file.type ?? '').toLowerCase().trim();
  if (UNSUPPORTED_MIME.includes(type)) return true;
  const name = (file.name ?? '').toLowerCase().trim();
  return UNSUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export const UNSUPPORTED_FORMAT_MESSAGE =
  'iPhone HEIC photos cannot be checked. Please use the camera above, or choose '
  + 'a JPEG or PNG file. (On iPhone: Settings → Camera → Formats → Most Compatible.)';

/**
 * Prepare a user-selected file for upload.
 *
 * JPEG and PNG are supported and are re-encoded to JPEG so the stored object
 * matches the content type it is uploaded under. Re-encoding on a canvas also
 * strips EXIF, including the GPS tag a phone photo often carries — we have no
 * purpose for a customer's location (APP 3), so not collecting it is better
 * than holding it.
 */
export async function toUploadableJpeg(file: File | Blob): Promise<Blob> {
  if (isUnsupportedCaptureFormat(file as File)) {
    throw new UnreadableCaptureError(UNSUPPORTED_FORMAT_MESSAGE);
  }

  if (typeof createImageBitmap !== 'function') {
    if (file.type === 'image/jpeg') return file;
    throw new UnreadableCaptureError(
      'This browser cannot process that image. Please choose a JPEG photo.',
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UnreadableCaptureError(
      'We could not read that image. Please take a new photo, or choose a JPEG or PNG file.',
    );
  }

  try {
    return await drawToJpeg(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close?.();
  }
}
