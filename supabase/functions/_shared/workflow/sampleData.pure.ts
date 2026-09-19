/**
 * Plausible stand-in data, derived from what a catalog step says it emits.
 *
 * Lives on its own because both the engine and the performers need it and they
 * already point at each other for types — importing it across that seam would
 * be a real circular import at runtime, not just a type one.
 */

import type { CatalogNode } from './types.pure.ts';

/**
 * Sample output shaped like the step's declared outputs, so a downstream
 * `{{…}}` reference resolves to something of the right *type* rather than to
 * nothing.
 *
 * Strings are marked rather than plausible-looking. A test run's whole job is to
 * show what would be sent, and `"[sample email]"` appearing in a message body is
 * information; `"jane@example.com"` sitting there looking real is a trap.
 */
export function sampleOutput(definition: CatalogNode): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const declared of definition.outputs) {
    switch (declared.type) {
      case 'number':
        output[declared.key] = 0;
        break;
      case 'boolean':
        output[declared.key] = false;
        break;
      case 'array':
        output[declared.key] = [];
        break;
      case 'object':
        output[declared.key] = {};
        break;
      default:
        output[declared.key] = `[sample ${declared.key}]`;
    }
  }
  return output;
}
