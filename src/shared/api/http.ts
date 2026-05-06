import { browserLogger } from '../lib/browserLogger';

export const localApiBase =
  import.meta.env.VITE_LOCAL_API ?? 'http://localhost:3001';
const authTokenKey = 'meeple-scope-token';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function requestJson<T>(
  input: string,
  init: RequestInit,
  errorPrefix: string,
): Promise<T> {
  const startedAt = performance.now();
  browserLogger.debug('api', `${init.method ?? 'GET'} ${input} -> start`);

  const response = await fetch(input, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  browserLogger.debug('api', `${init.method ?? 'GET'} ${input} -> ${response.status}`, {
    durationMs: Math.round(performance.now() - startedAt),
  });

  if (!response.ok) {
    let message = `${response.status}`;

    try {
      const body = (await response.json()) as { message?: string };
      message = body.message ?? message;
    } catch {
      message = response.statusText || message;
    }

    const error = new ApiError(`${errorPrefix}: ${message}`, response.status);
    browserLogger.error('api', `${init.method ?? 'GET'} ${input} failed`, error);
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function getAuthToken() {
  return (
    window.sessionStorage.getItem(authTokenKey) ??
    window.localStorage.getItem(authTokenKey)
  );
}

export function setAuthToken(token: string) {
  window.sessionStorage.setItem(authTokenKey, token);
  window.localStorage.setItem(authTokenKey, token);
  window.dispatchEvent(new Event('meeple-scope-auth'));
}

export function clearAuthToken() {
  window.sessionStorage.removeItem(authTokenKey);
  window.localStorage.removeItem(authTokenKey);
  window.dispatchEvent(new Event('meeple-scope-auth'));
}

export function localRequest<T>(path: string, init: RequestInit = {}) {
  const token = getAuthToken();

  return requestJson<T>(
    `${localApiBase}${path}`,
    {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    },
    'Ошибка локального API',
  );
}
