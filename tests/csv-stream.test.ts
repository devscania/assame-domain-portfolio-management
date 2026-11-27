import { describe, expect, it, vi } from 'vitest';
import { csvStream } from '../src/lib/csv-stream';

describe('CSV stream', () => {
  it('honors backpressure and cancellation while a page is in flight', async () => {
    let resolve!: (rows: unknown[][]) => void;
    const next = vi.fn(
      () =>
        new Promise<unknown[][]>((done) => {
          resolve = done;
        }),
    );
    const reader = csvStream('name', next).getReader();
    expect(next).not.toHaveBeenCalled();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('name\r\n');
    const pending = reader.read();
    await Promise.resolve();
    expect(next).toHaveBeenCalledTimes(1);
    await reader.cancel();
    resolve([['ignored']]);
    await pending;
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('escapes spreadsheet formulas and CSV quoting', async () => {
    const next = vi
      .fn()
      .mockResolvedValueOnce([['=2+2', 'a,b']])
      .mockResolvedValue([]);
    const body = await new Response(csvStream('name,note', next)).text();
    expect(body).toContain("'=2+2");
    expect(body).toContain('"a,b"');
  });
});
