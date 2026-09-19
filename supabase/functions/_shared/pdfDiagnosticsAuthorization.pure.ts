const PDF_DIAGNOSTICS_BUCKET = 'pdf-import-diagnostics';

/**
 * Diagnostics objects are stored below the job UUID. Never allow staged
 * client metadata (or a manifest it selects) to escape that authorized prefix.
 */
export function isPdfDiagnosticsPathOwnedByJob(
  path: string | null | undefined,
  jobId: string | null | undefined,
): boolean {
  if (!path || !jobId || typeof path !== 'string' || typeof jobId !== 'string') return false;

  const trimmedPath = path.trim();
  const trimmedJobId = jobId.trim();
  if (!trimmedPath || !trimmedJobId || trimmedJobId.includes('/') || trimmedJobId.includes('\\')) return false;

  const objectPath = trimmedPath.startsWith(`${PDF_DIAGNOSTICS_BUCKET}/`)
    ? trimmedPath.slice(PDF_DIAGNOSTICS_BUCKET.length + 1)
    : trimmedPath;
  const segments = objectPath.split('/');

  return segments[0] === trimmedJobId
    && segments.length > 1
    && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    && !objectPath.includes('\\');
}
