/**
 * Which listing URLs this function will scrape.
 *
 * The host allow-list itself lives in `_shared/pageRead/pageReadRoute.pure.ts`
 * and is imported rather than restated: a page read may now be performed by
 * Mission Control on a clone's behalf, and the broker has to enforce the
 * identical list. Two copies of "which hosts may be fetched" is how a broker
 * comes to accept a host the caller's own normaliser would have refused.
 *
 * This module keeps its own name and its own exception-throwing shape, because
 * that is what the caller and its tests are written against.
 */
import { isPropertyListingHost } from '../_shared/pageRead/pageReadRoute.pure.ts';

export function normalizePropertyListingUrl(input: string): string {
  let formattedUrl = input.trim();
  if (!/^https?:\/\//i.test(formattedUrl)) {
    formattedUrl = `https://${formattedUrl}`;
  }

  const parsedUrl = new URL(formattedUrl);
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || parsedUrl.port) {
    throw new Error("Property listing URL must use HTTPS without credentials or a custom port");
  }
  if (!isPropertyListingHost(parsedUrl.hostname)) {
    throw new Error("Unsupported property listing host");
  }

  return parsedUrl.toString();
}
