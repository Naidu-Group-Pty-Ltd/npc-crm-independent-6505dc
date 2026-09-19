const MAX_REQUEST_BYTES = 32 * 1024;

export class RequestTooLargeError extends Error {}

/** Read JSON without allowing an authenticated caller to make the runtime buffer an unbounded body. */
export async function readBoundedJson(req: Request): Promise<unknown> {
  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new RequestTooLargeError('Request body is too large');
  }

  if (!req.body) return {};
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RequestTooLargeError('Request body is too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text ? JSON.parse(text) : {};
}

export function isRequestBody(value: unknown): value is { snapshot?: unknown; session_token?: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return (body.snapshot === undefined || (typeof body.snapshot === 'object' && body.snapshot !== null && !Array.isArray(body.snapshot)))
    && (body.session_token === undefined || typeof body.session_token === 'string');
}
