export const MAX_REFERENCE_IMAGES = 4;
export const MAX_REFERENCE_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_REFERENCE_IMAGES_TOTAL_BYTES = 4 * 1024 * 1024;

const IMAGE_SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  "image/png": (bytes) =>
    bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((byte, index) => bytes[index] === byte),
  "image/jpeg": (bytes) =>
    bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/webp": (bytes) =>
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP",
};

function decodeBase64(value: string): Uint8Array {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("reference images must contain valid base64 data");
  }

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const decodedLength = (value.length / 4) * 3 - padding;
  if (decodedLength > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(`each reference image must be at most ${MAX_REFERENCE_IMAGE_BYTES} bytes`);
  }

  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("reference images must contain valid base64 data");
  }
}

export function validateReferenceImages(input: unknown): string[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error("referenceImages must be an array");
  if (input.length > MAX_REFERENCE_IMAGES) {
    throw new Error(`no more than ${MAX_REFERENCE_IMAGES} reference images are allowed`);
  }

  let totalBytes = 0;
  return input.map((reference) => {
    if (typeof reference !== "string") throw new Error("reference images must be strings");

    const dataUrl = /^data:([^;,]+);base64,(.*)$/i.exec(reference);
    const mimeType = dataUrl ? dataUrl[1].toLowerCase() : "image/png";
    const base64 = dataUrl ? dataUrl[2] : reference;
    const matchesSignature = IMAGE_SIGNATURES[mimeType];
    if (!matchesSignature) {
      throw new Error("reference images must be PNG, JPEG, or WebP");
    }

    const bytes = decodeBase64(base64);
    if (!matchesSignature(bytes)) {
      throw new Error(`reference image content does not match ${mimeType}`);
    }

    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_REFERENCE_IMAGES_TOTAL_BYTES) {
      throw new Error(`reference images must total at most ${MAX_REFERENCE_IMAGES_TOTAL_BYTES} bytes`);
    }

    return `data:${mimeType};base64,${base64}`;
  });
}
