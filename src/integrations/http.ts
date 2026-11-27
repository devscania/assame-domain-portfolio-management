import { AppError } from '@/lib/security';
import { brand } from '@/lib/brand';
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export function retryDelay(attempt: number, retryAfter: string | null, now = Date.now()) {
  const parsed = retryAfter ? Number(retryAfter) : NaN;
  const specified = Number.isFinite(parsed)
    ? parsed * 1000
    : retryAfter
      ? Date.parse(retryAfter) - now
      : 0;
  return Math.max(0, specified || 0, Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500);
}
export class ProviderHttp {
  private next = 0;
  constructor(
    private base: string,
    private headers: Record<string, string>,
    private interval: number,
    private fetcher: typeof fetch = fetch,
    private wait = sleep,
    private beforeRequest?: () => Promise<void>,
  ) {}
  async mutate(
    method: 'PATCH' | 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<void> {
    await this.mutationResponse(method, path, body);
  }
  async mutateJson(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await this.mutationResponse(method, path, body);
    try {
      return await response.json();
    } catch {
      throw new AppError(
        'Provider update response is uncertain. Remote verification is required before retrying.',
        502,
      );
    }
  }
  async mutateText(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    onRejected?: (body: string) => void,
    form?: URLSearchParams,
  ): Promise<string> {
    const response = await this.mutationResponse(method, path, form, onRejected);
    try {
      return await response.text();
    } catch {
      throw new AppError(
        'Provider update response is uncertain. Remote verification is required before retrying.',
        502,
      );
    }
  }
  private async mutationResponse(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    onRejected?: (body: string) => void,
  ): Promise<Response> {
    // Atom exposes price updates as GET. Mutations deliberately never use the
    // retrying get() transport: an uncertain response must be reconciled first.
    await this.wait(Math.max(0, this.next - Date.now()));
    this.next = Date.now() + this.interval;
    let response: Response;
    try {
      response = await this.fetcher(this.base + path, {
        method,
        headers: {
          ...this.headers,
          'User-Agent': `${brand.name}/0.1.0`,
          Accept: body instanceof URLSearchParams ? 'application/xml' : 'application/json',
          ...(body && !(body instanceof URLSearchParams) ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: body instanceof URLSearchParams ? body : JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });
    } catch {
      throw new AppError(
        'Provider update response is uncertain. Remote verification is required before retrying.',
        502,
      );
    }
    if (!response.ok) {
      if (onRejected && [400, 403, 422].includes(response.status))
        onRejected(await response.text().catch(() => ''));
      throw new AppError(
        `Provider rejected the update (HTTP ${response.status}). Check write permissions and provider pricing restrictions.`,
        response.status === 429 ? 429 : 502,
      );
    }
    // Neither HTTP 200 nor 202 alone proves a price was applied. The caller re-reads it.
    return response;
  }
  async get(path: string, beforeAttempt?: () => Promise<void>): Promise<unknown> {
    return this.read(path, false, false, beforeAttempt);
  }
  async getText(path: string, form?: URLSearchParams): Promise<string> {
    return (await this.read(path, true, false, undefined, form)) as string;
  }
  async getOptional(path: string): Promise<unknown | null> {
    return this.read(path, false, true);
  }
  private async read(
    path: string,
    text: boolean,
    allowMissing = false,
    beforeAttempt?: () => Promise<void>,
    form?: URLSearchParams,
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.wait(Math.max(0, this.next - Date.now()));
      this.next = Date.now() + this.interval;
      await this.beforeRequest?.();
      await beforeAttempt?.();
      let response: Response;
      try {
        response = await this.fetcher(this.base + path, {
          ...(form ? { method: 'POST', body: form } : {}),
          headers: {
            ...this.headers,
            'User-Agent': `${brand.name}/0.1.0`,
            Accept: text ? 'application/xml' : 'application/json',
          },
          signal: AbortSignal.timeout(30000),
          redirect: 'error',
        });
      } catch {
        if (attempt === 4) throw new AppError('Provider network timeout or unavailable', 502);
        await this.wait(retryDelay(attempt, null));
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 4) {
        const delay = retryDelay(attempt, response.headers.get('retry-after'));
        if (delay > 300000)
          throw new AppError('Provider rate limited: retry after the provider cooldown', 429);
        await this.wait(delay);
        continue;
      }
      if (allowMissing && response.status === 404) return null;
      if (!response.ok)
        throw new AppError(
          `Provider returned HTTP ${response.status}. Check account permissions or retry.`,
          502,
        );
      if (response.status === 202)
        throw new AppError('Provider operation is pending; no completed data was returned', 502);
      try {
        if (text) return await response.text();
        return await response.json();
      } catch {
        throw new AppError('Provider returned an invalid response', 502);
      }
    }
    throw new AppError('Provider retries exhausted', 502);
  }
}
