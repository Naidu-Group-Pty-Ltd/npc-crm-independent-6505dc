import { describe, expect, it } from "vitest";
import {
  MAX_REFERENCE_IMAGE_BYTES,
  validateReferenceImages,
} from "../../supabase/functions/hero-image-studio/referenceImages.ts";

const png = (bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) =>
  Buffer.from(bytes).toString("base64");

describe("hero-image-studio reference image validation", () => {
  it("normalizes valid raw PNG base64", () => {
    expect(validateReferenceImages([png()])).toEqual([`data:image/png;base64,${png()}`]);
  });

  it.each([
    ["unsupported MIME type", ["data:text/html;base64,PGgxPmJhZDwvaDE+"]],
    ["invalid base64", ["not-valid-base64-$$"]],
    ["mismatched content", [`data:image/jpeg;base64,${png()}`]],
    ["too many images", Array(5).fill(png())],
    ["non-string values", [123]],
  ])("rejects %s", (_label, input) => {
    expect(() => validateReferenceImages(input)).toThrow();
  });

  it("rejects per-image and aggregate decoded-size limit violations", () => {
    const oversized = new Uint8Array(MAX_REFERENCE_IMAGE_BYTES + 1);
    oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => validateReferenceImages([png(oversized)])).toThrow(/each reference image/);

    const aggregate = new Uint8Array(MAX_REFERENCE_IMAGE_BYTES);
    aggregate.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => validateReferenceImages([png(aggregate), png(aggregate), png()]))
      .toThrow(/must total/);
  });
});
