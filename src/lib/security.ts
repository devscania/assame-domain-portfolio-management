import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import pino from 'pino';
export function createLogger(destination?: pino.DestinationStream) {
  const options = {
    redact: {
      paths: [
        'password',
        'passwordHash',
        'apiKey',
        'apiSecret',
        'authorization',
        'headers',
        'credential',
        'ciphertext',
        'api_token',
      ],
      censor: '[REDACTED]',
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
export const logger = createLogger();
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
export function isAppError(error: unknown): error is AppError {
  return (
    error instanceof AppError ||
    (typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof (error as Record<string, unknown>).message === 'string' &&
      ((error as Record<string, unknown>).name === 'AppError' ||
        typeof (error as Record<string, unknown>).status === 'number'))
  );
}
function key() {
  const value = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new AppError('Credential encryption is not configured', 503);
  return Buffer.from(value, 'hex');
}
export function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((v) => v.toString('base64')).join('.');
}
export function decrypt<T>(value: string): T {
  const [iv, tag, data] = value.split('.').map((v) => Buffer.from(v, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8')) as T;
}
export function assertOrigin(request: Request) {
  const originHeader = request.headers.get('origin');
  if (!originHeader) throw new AppError('Invalid request origin', 403);
  const expectedUrl = new URL(process.env.AUTH_URL || 'http://localhost:3010');
  if (originHeader === expectedUrl.origin) return;
  try {
    const actualUrl = new URL(originHeader);
    const reqUrl = new URL(request.url);
    const hostHeader = request.headers.get('host');
    const reqPort =
      hostHeader?.split(':')[1] || reqUrl.port || (reqUrl.protocol === 'https:' ? '443' : '80');
    const expectedPort = expectedUrl.port || (expectedUrl.protocol === 'https:' ? '443' : '80');
    const actualPort = actualUrl.port || (actualUrl.protocol === 'https:' ? '443' : '80');
    const isLoopback = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
    if (
      actualUrl.protocol === expectedUrl.protocol &&
      isLoopback(expectedUrl.hostname) &&
      isLoopback(actualUrl.hostname) &&
      (actualPort === expectedPort || actualPort === reqPort)
    ) {
      return;
    }
  } catch {
    // Fall through to AppError
  }
  throw new AppError('Invalid request origin', 403);
}
export function safeProviderError(error: unknown) {
  // Only application-generated diagnostics are safe to expose. Third-party and
  // transport exceptions can contain full URLs, credentials, or response bodies.
  if (error instanceof AppError) {
    return error.message;
  }
  return 'Provider request failed. Check permissions and retry; secrets and response bodies are withheld.';
}
export async function readJson(request: Request, maximum = 12_000_000): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new AppError('JSON request required', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('Request body required');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    length += item.value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new AppError('Request too large', 413);
    }
    chunks.push(item.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('Invalid JSON request');
  }
}
