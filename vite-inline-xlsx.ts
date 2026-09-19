import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/**
 * Vite 5 does not support `?inline` on binary assets (CSS only), so an
 * `import wb from "…xlsx?inline"` would emit a file under /assets/ and break
 * downloads on deployments that prune unreferenced assets. This plugin turns
 * such imports into a self-contained base64 data URL instead.
 *
 * Word documents go through the same path, for the same reason plus one more:
 * a document inlined into the bundle has no fetchable URL of its own. That
 * matters for the intake pack's worked examples, where the bytes must reach the
 * browser to be rendered but the file is deliberately not offered as a
 * download.
 */
const INLINE_MIME_TYPES: Record<string, string> = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function inlineOfficeDocumentPlugin(): Plugin {
  const extensions = Object.keys(INLINE_MIME_TYPES);
  const matchExtension = (id: string) =>
    extensions.find((extension) => id.endsWith(`${extension}?inline`));

  return {
    name: "npc-inline-office-document",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!matchExtension(source)) return null;
      const resolved = await this.resolve(source.slice(0, -"?inline".length), importer, {
        skipSelf: true,
      });
      return resolved ? `${resolved.id}?inline` : null;
    },
    load(id) {
      const extension = matchExtension(id);
      if (!extension) return null;
      const file = id.slice(0, -"?inline".length);
      const base64 = readFileSync(file).toString("base64");
      return `export default "data:${INLINE_MIME_TYPES[extension]};base64,${base64}";`;
    },
  };
}

/** Previous name, kept so nothing that imports it has to change. */
export const inlineXlsxPlugin = inlineOfficeDocumentPlugin;
