import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { MAX_UPLOAD_BYTES, validateImageUpload } from "./imageUpload.ts";

function encode(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

Deno.test("accepts PNG and derives trusted dimensions and MIME from its header", () => {
  const png = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0, 32, 0, 0, 0, 16,
    0, 0, 0, 0, 0x49, 0x44, 0x41, 0x54, 0, 0, 0, 0,
    0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0,
  ];
  const result = validateImageUpload(`data:image/png;base64,${encode(png)}`);
  assert(result);
  assertEquals({ contentType: result.contentType, extension: result.extension, width: result.width, height: result.height }, {
    contentType: "image/png", extension: "png", width: 32, height: 16,
  });
});

Deno.test("rejects active content, MIME mismatches, unsafe dimensions, and oversized data before decoding", () => {
  assertEquals(validateImageUpload(`data:text/html;base64,${btoa("<script>alert(1)</script>")}`), null);
  const png = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0, 1, 0, 0, 0, 1,
    0, 0, 0, 0, 0x49, 0x44, 0x41, 0x54, 0, 0, 0, 0,
    0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0,
  ];
  assertEquals(validateImageUpload(`data:image/jpeg;base64,${encode(png)}`), null);
  const unsafe = [...png];
  unsafe.splice(16, 8, 0, 0, 0x4e, 0x20, 0, 0, 0x4e, 0x20);
  assertEquals(validateImageUpload(encode(unsafe)), null);
  assertEquals(validateImageUpload("A".repeat(Math.ceil((MAX_UPLOAD_BYTES + 1) / 3) * 4)), null);
});
