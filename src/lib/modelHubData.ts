export const MODEL_HUB_REQUEST_TIMEOUT_MS = 30_000;

export class ModelHubResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelHubResponseError';
  }
}

export function withTimeout<T>(promise: PromiseLike<T>, timeoutMs = MODEL_HUB_REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => reject(new ModelHubResponseError('The model service did not respond in time. Please retry.')),
      timeoutMs,
    );

    Promise.resolve(promise).then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function assertObjectResponse(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ModelHubResponseError(`${label} returned an invalid response.`);
  }
  return value as Record<string, unknown>;
}

export function responseErrorMessage(value: Record<string, unknown>, fallback: string): string {
  return typeof value.error === 'string' && value.error.trim() ? value.error : fallback;
}

export function assertArrayField(value: Record<string, unknown>, field: string, label: string): unknown[] {
  if (!Array.isArray(value[field])) {
    throw new ModelHubResponseError(`${label} response is missing ${field}.`);
  }
  return value[field];
}

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'An unexpected error occurred.';
}
