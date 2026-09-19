export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 14 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 40_000_000;

export type ValidatedImage = {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
};

function dimensionsAreSafe(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) &&
    width > 0 && height > 0 && width <= MAX_IMAGE_DIMENSION &&
    height <= MAX_IMAGE_DIMENSION && width * height <= MAX_IMAGE_PIXELS;
}

function pngDimensions(bytes: Uint8Array): [number, number] | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 45 || !signature.every((value, index) => bytes[index] === value) ||
    String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR" ||
    String.fromCharCode(...bytes.slice(-8, -4)) !== "IEND") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

function jpegDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      if (length < 7) return null;
      return [(bytes[offset + 5] << 8) | bytes[offset + 6], (bytes[offset + 3] << 8) | bytes[offset + 4]];
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 25 || String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP") return null;
  const declaredSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8;
  if (declaredSize !== bytes.length) return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === "VP8X" && bytes.length >= 30) {
    return [1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)];
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return [((bytes[27] << 8) | bytes[26]) & 0x3fff, ((bytes[29] << 8) | bytes[28]) & 0x3fff];
  }
  return null;
}

/** Validates the encoded size before allocation, then derives MIME and dimensions from the file bytes. */
export function validateImageUpload(value: unknown): ValidatedImage | null {
  if (typeof value !== "string" || !value) return null;
  let declaredType: string | null = null;
  let encoded = value;
  if (value.startsWith("data:")) {
    const separator = value.indexOf(",");
    if (separator < 0) return null;
    const header = value.slice(5, separator);
    if (!header.endsWith(";base64") || header.slice(0, -7).includes(";")) return null;
    declaredType = header.slice(0, -7).toLowerCase();
    encoded = value.slice(separator + 1);
  }
  const maxEncodedLength = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
  if (!encoded || encoded.length > maxEncodedLength || encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  const decodedLength = (encoded.length * 3) / 4 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (decodedLength > MAX_UPLOAD_BYTES) return null;

  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const candidates = [
    { contentType: "image/png" as const, extension: "png" as const, dimensions: pngDimensions(bytes) },
    { contentType: "image/jpeg" as const, extension: "jpg" as const, dimensions: jpegDimensions(bytes) },
    { contentType: "image/webp" as const, extension: "webp" as const, dimensions: webpDimensions(bytes) },
  ];
  const image = candidates.find((candidate) => candidate.dimensions !== null);
  if (!image || !dimensionsAreSafe(image.dimensions![0], image.dimensions![1])) return null;
  if (declaredType && declaredType !== image.contentType) return null;
  return { bytes, contentType: image.contentType, extension: image.extension, width: image.dimensions![0], height: image.dimensions![1] };
}
