/**
 * PDF Extraction V3 · E12 — private corpus registry + injected source resolver.
 *
 * The private registry holds ONLY opaque ids + hashes + approved metadata — never
 * a source path, filename (when sensitive), signed URL, extracted text or private
 * value. Source bytes are fetched at run time through an INJECTED resolver that
 * verifies the hash and returns a runtime-only handle with guaranteed cleanup;
 * it never returns a persisted signed URL. A fake resolver is used in tests; the
 * real one is wired only in a protected, manually-dispatched workflow.
 */
import {
  PRIVATE_CORPUS_REGISTRY_VERSION,
  type PrivateCorpusRegistrationV1,
  type PrivateCorpusRegistryV1,
} from './contracts';
import { scanForbidden, stableHash } from './redaction';

export function buildPrivateCorpusRegistry(items: PrivateCorpusRegistrationV1[]): PrivateCorpusRegistryV1 {
  const registryId = stableHash('pcr', items.map((i) => ({ corpusId: i.corpusId, sourceSha256: i.sourceSha256, requiredGateTier: i.requiredGateTier })));
  return { version: PRIVATE_CORPUS_REGISTRY_VERSION, registryId, items, problems: [] };
}

/** Validate a private registration carries no leaked private content. */
export function validatePrivateRegistration(item: PrivateCorpusRegistrationV1): string[] {
  const problems: string[] = [];
  // Never a source path / filename / signed URL anywhere in the registration.
  const leaks = scanForbidden(item);
  problems.push(...leaks);
  if (!/^[a-f0-9]{64}$/i.test(item.sourceSha256)) problems.push('invalid_source_sha256');
  if (item.privateSourceResolverKey.includes('://')) problems.push('resolver_key_must_not_be_url');
  if (/\//.test(item.privateSourceResolverKey)) problems.push('resolver_key_must_not_be_path');
  return Array.from(new Set(problems));
}

// ── Injected source resolver ─────────────────────────────────────────────────

export interface PrivateSourceHandle {
  /** Runtime-only bytes — never persisted, never uploaded, never logged. */
  bytes: Uint8Array;
  sourceSize: number;
  hashVerified: boolean;
  cleanup: () => Promise<void>;
}

export interface PrivateSourceResolverContext {
  trusted: boolean;
  isFork: boolean;
  authorizedEnvironment: boolean;
}

export type PrivateSourceResolver = (
  corpusId: string,
  expectedSha256: string,
  ctx: PrivateSourceResolverContext,
) => Promise<PrivateSourceHandle>;

/** Guard: refuse to resolve a private source on a fork / unauthorized environment. */
export function assertResolverContext(ctx: PrivateSourceResolverContext): string | null {
  if (ctx.isFork) return 'fork_context_blocked';
  if (!ctx.trusted) return 'untrusted_context_blocked';
  if (!ctx.authorizedEnvironment) return 'unauthorized_environment_blocked';
  return null;
}

/**
 * Wrap a resolver with context + hash enforcement. The wrapped resolver blocks
 * fork/untrusted/unauthorized contexts and rejects a source whose hash does not
 * match the expected value BEFORE the bytes are used.
 */
export function guardedResolver(resolver: PrivateSourceResolver): PrivateSourceResolver {
  return async (corpusId, expectedSha256, ctx) => {
    const block = assertResolverContext(ctx);
    if (block) throw Object.assign(new Error('private_source_blocked'), { code: block });
    const handle = await resolver(corpusId, expectedSha256, ctx);
    if (!handle.hashVerified) {
      await handle.cleanup();
      throw Object.assign(new Error('source_hash_mismatch'), { code: 'source_hash_mismatch' });
    }
    return handle;
  };
}

/** A deterministic fake resolver for unit tests (never touches real storage). */
export function createFakeResolver(sources: Record<string, { bytes: Uint8Array; sha256: string }>): PrivateSourceResolver {
  return async (corpusId, expectedSha256) => {
    const src = sources[corpusId];
    const hashVerified = Boolean(src) && src.sha256 === expectedSha256;
    return {
      bytes: src ? src.bytes : new Uint8Array(),
      sourceSize: src ? src.bytes.length : 0,
      hashVerified,
      cleanup: async () => { /* no-op for fake */ },
    };
  };
}
