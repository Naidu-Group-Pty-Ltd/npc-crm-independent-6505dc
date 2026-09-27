/**
 * A clone's templated cover never carries the house's tagline.
 *
 * Seed v23 (`20261225090000`) replaced the literal "Your dedicated property
 * partner" on every master's cover with `{{org.tagline}}`, which only the
 * prime publishes (`organisationProjection.pure.ts`): the prime's covers print
 * what they always printed, and a clone's cover draws no tagline, because a
 * bound text block that resolves to nothing is not drawn.
 *
 * Two kinds of master never receive that change:
 *
 *  - one somebody customised, because the v23 refresh copies only masters
 *    still on their release baseline;
 *  - every master on a clone the seed does not reach. A clone takes the
 *    prime's migrations through Mission Control's cascade, and a seed larger
 *    than the cascade carries in one file never arrives (`CLAUDE.md`, *Report
 *    templates*). v23 is 42 MB.
 *
 * So the same rule is applied where the document is drawn. On a clone, a block
 * value that says nothing but the house's tagline is given the binding v23
 * would have given it, and resolves to nothing there. On the prime nothing is
 * touched: the schema is returned as it was given, the same object.
 *
 * Only a value that IS the tagline is changed (`isHouseTagline`: the whole
 * string, however it is cased or spaced), never a sentence that mentions it.
 */
import { isHouseTagline } from '../../../supabase/functions/_shared/reports/issuerIdentity.pure.ts';

/** The binding seed v23 puts where the literal was. */
export const ISSUER_TAGLINE_BINDING = '{{org.tagline}}';

/** Any template shape with pages of blocks; what else it carries is passed through untouched. */
interface SchemaWithBlocks {
  pages?: unknown;
}

/**
 * The template, with the house's tagline bound to the issuer's on a clone.
 *
 * `prime` is the deployment's own answer (`isPrimeDeployment`), never a name a
 * settings row holds: a clone seeded from the prime's rows holds NPC's name.
 */
export function withIssuerTagline<T extends SchemaWithBlocks>(schema: T, deployment: { prime: boolean }): T {
  if (deployment.prime || !Array.isArray(schema.pages)) return schema;
  let changed = false;
  const pages = (schema.pages as unknown[]).map((page) => {
    if (!page || typeof page !== 'object') return page;
    const blocks = (page as { blocks?: unknown }).blocks;
    if (!Array.isArray(blocks)) return page;
    let pageChanged = false;
    const next = blocks.map((block) => {
      const props = (block as { props?: unknown })?.props;
      if (!props || typeof props !== 'object' || Array.isArray(props)) return block;
      let blockChanged = false;
      const out: Record<string, unknown> = { ...(props as Record<string, unknown>) };
      for (const [key, value] of Object.entries(out)) {
        if (isHouseTagline(value)) {
          out[key] = ISSUER_TAGLINE_BINDING;
          blockChanged = true;
        }
      }
      if (!blockChanged) return block;
      pageChanged = true;
      return { ...(block as object), props: out };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...(page as object), blocks: next };
  });
  return changed ? { ...schema, pages } : schema;
}
