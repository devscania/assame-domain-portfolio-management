import { afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ validate: vi.fn() }));
vi.mock('../src/lib/runtime-config', () => ({ validateRuntimeConfig: fixture.validate }));
import { register } from '../src/instrumentation';

afterEach(() => {
  fixture.validate.mockReset();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('server startup instrumentation', () => {
  it('does not validate deployment credentials during build or non-Node instrumentation', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    await register();
    vi.stubEnv('NEXT_PHASE', 'phase-production-server');
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    expect(fixture.validate).not.toHaveBeenCalled();
  });
  it('validates the runtime configuration before serving', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NEXT_PHASE', 'phase-production-server');
    await register();
    expect(fixture.validate).toHaveBeenCalledWith(process.env);
  });
  it('exits on invalid configuration without printing the thrown error', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NEXT_PHASE', 'phase-production-server');
    fixture.validate.mockImplementation(() => { throw new Error('synthetic-secret-do-not-print'); });
    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation((): never => { throw new Error('test exit'); });
    await expect(register()).rejects.toThrow('test exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(output.mock.calls.flat().join(' ')).not.toContain('synthetic-secret');
    expect(output).toHaveBeenCalledWith(expect.stringContaining('configuration is invalid'));
  });
});
