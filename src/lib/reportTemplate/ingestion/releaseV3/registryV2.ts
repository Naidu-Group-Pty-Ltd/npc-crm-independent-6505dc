/**
 * PDF Extraction V3 · E12 — Golden Corpus Registry V2 builder + fixture selection.
 *
 * Assembles the deterministic registry from the fixture family catalog and the
 * per-tier required fixture ids. Registry identity derives from the semantic
 * fixture registrations + threshold policy (NOT `updatedAt`). The V1 registry
 * remains readable elsewhere; this V2 registry never treats V1 as complete.
 */
import {
  GOLDEN_CORPUS_REGISTRY_V2_VERSION,
  RELEASE_THRESHOLDS_VERSION,
  type GeneratedFixtureRegistrationV1,
  type GoldenCorpusRegistryV2,
  type PrivateCorpusRegistrationV1,
  type ReleaseGateTier,
} from './contracts';
import { FIXTURE_FAMILIES } from './fixtureFamilies';
import { stableHash } from './redaction';

export function buildGoldenCorpusRegistryV2(
  privateFixtures: PrivateCorpusRegistrationV1[] = [],
  updatedAt = '1970-01-01T00:00:00.000Z',
): GoldenCorpusRegistryV2 {
  const generatedFixtures: GeneratedFixtureRegistrationV1[] = FIXTURE_FAMILIES.map((f) => ({
    fixtureId: f.spec.fixtureId,
    family: f.spec.family,
    sourceBuilderVersion: f.spec.sourceBuilderVersion,
    seed: f.spec.seed,
    requiredReleaseTiers: f.spec.requiredReleaseTiers,
    performanceClass: f.spec.performanceClass,
  }));

  const requiredFixtureIdsByTier = {
    static: [],
    'generated-fast': FIXTURE_FAMILIES.filter((f) => f.spec.requiredReleaseTiers.includes('generated-fast')).map((f) => f.spec.fixtureId),
    'generated-full': FIXTURE_FAMILIES.filter((f) => f.spec.requiredReleaseTiers.includes('generated-full')).map((f) => f.spec.fixtureId),
    'private-controlled': privateFixtures.filter((p) => p.requiredGateTier === 'private-controlled').map((p) => p.corpusId),
    'zero-traffic-runtime': [],
    'canary-promotion': [],
  } as Record<ReleaseGateTier, string[]>;

  const registryId = stableHash('gcr', {
    generatedFixtures,
    privateFixtures: privateFixtures.map((p) => ({ corpusId: p.corpusId, sourceSha256: p.sourceSha256, requiredGateTier: p.requiredGateTier })),
    thresholdPolicyVersion: RELEASE_THRESHOLDS_VERSION,
  });

  return {
    version: GOLDEN_CORPUS_REGISTRY_V2_VERSION,
    registryId,
    generatedFixtures,
    privateFixtures,
    requiredFixtureIdsByTier,
    thresholdPolicyVersion: RELEASE_THRESHOLDS_VERSION,
    updatedAt,
    problems: [],
  };
}

/** The fixture ids required for a given release tier. */
export function requiredFixturesForTier(registry: GoldenCorpusRegistryV2, tier: ReleaseGateTier): string[] {
  return registry.requiredFixtureIdsByTier[tier] ?? [];
}
