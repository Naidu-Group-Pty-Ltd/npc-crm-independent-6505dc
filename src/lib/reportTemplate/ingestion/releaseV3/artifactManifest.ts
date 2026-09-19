/**
 * PDF Extraction V3 · E12 — release artifact manifest + upload policy.
 *
 * Classifies generated evidence artifacts, marks which may be uploaded, and
 * detects forbidden content. Private fixtures never upload source/browser/export
 * images by default; generated fixtures may upload sanitized JSON + permitted
 * diffs. A forbidden artifact (PDF/image binary outside approved generated temp
 * scope, signed URL, credential) is recorded and blocks upload.
 */
import {
  RELEASE_ARTIFACT_MANIFEST_VERSION,
  type ReleaseArtifactEntryV1,
  type ReleaseArtifactManifestV1,
  type ReleaseArtifactPolicyV1,
} from './contracts';
import { scanForbidden } from './redaction';

export interface RawArtifactInput {
  kind: string;
  fixtureId: string;
  relativePath: string;
  sha256: string | null;
  byteSize: number | null;
  private: boolean;
  /** Whether this is a media binary (pdf/png/jpg …). */
  isBinaryMedia: boolean;
}

const APPROVED_GENERATED_TEMP = /(^|\/)\.pdf-v3-tmp\//;

export function buildArtifactManifest(
  runId: string,
  raw: RawArtifactInput[],
  policy: ReleaseArtifactPolicyV1,
): ReleaseArtifactManifestV1 {
  const forbidden: string[] = [];
  const generatedArtifacts: ReleaseArtifactEntryV1[] = raw.map((a) => {
    let uploadPermitted = true;

    // Media binaries are never uploaded unless generated-temp + policy allows diffs.
    if (a.isBinaryMedia) {
      const generatedTemp = APPROVED_GENERATED_TEMP.test(a.relativePath) && !a.private;
      uploadPermitted = generatedTemp && policy.allowGeneratedDiffUpload;
      if (a.private && !policy.allowPrivateImageUpload) uploadPermitted = false;
    }
    // Private artifacts default to no upload.
    if (a.private && a.isBinaryMedia && !policy.allowPrivateImageUpload) uploadPermitted = false;

    // Scan the path itself for leaks.
    const pathProblems = scanForbidden(a.relativePath, 'relativePath');
    if (pathProblems.length > 0) { uploadPermitted = false; forbidden.push(`${a.kind}:${pathProblems.join(',')}`); }

    return {
      kind: a.kind,
      fixtureId: a.fixtureId,
      relativePath: a.relativePath,
      sha256: a.sha256,
      byteSize: a.byteSize,
      private: a.private,
      uploadPermitted,
      retentionDays: policy.defaultRetentionDays,
    };
  });

  return {
    version: RELEASE_ARTIFACT_MANIFEST_VERSION,
    runId,
    generatedArtifacts,
    forbiddenArtifactsDetected: Array.from(new Set(forbidden)),
    problems: [],
  };
}
