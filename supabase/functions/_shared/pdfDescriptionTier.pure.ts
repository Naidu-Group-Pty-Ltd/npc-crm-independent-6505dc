export type PdfDescriptionTier = 'auto' | 'off' | 'on' | 'premium';

/**
 * Picture descriptions invoke a substantially more expensive parser path.
 * Only the trusted service role may opt a job into that path; user sessions
 * and user JWTs retain the normal automatic/off parsing behaviour.
 */
export function resolvePdfDescriptionTier(
  requested: unknown,
  authMethod: 'jwt' | 'session' | 'service_role' | undefined,
): PdfDescriptionTier {
  if (requested === 'off') return 'off';
  if (requested === 'on' || requested === 'premium') {
    return authMethod === 'service_role' ? requested : 'auto';
  }
  return 'auto';
}
