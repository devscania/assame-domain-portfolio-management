/** Connection policy for destructive fixture tools, never normal application startup. */
export function isLoopbackFixtureDatabase(value: string | undefined) {
  try {
    const database = new URL(value || '');
    if (
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) ||
      database.hash ||
      !/^[a-z0-9_]*(?:test|benchmark|browser)[a-z0-9_]*$/i.test(
        decodeURIComponent(database.pathname.slice(1)),
      )
    )
      return false;
    // Prisma's `host` query parameter can override the URI host. Restrict all
    // parameters rather than trying to enumerate every connection override.
    const seen = new Set<string>();
    for (const [key, parameter] of database.searchParams) {
      if (seen.has(key)) return false;
      seen.add(key);
      if (key === 'schema' && parameter === 'public') continue;
      const maximum =
        key === 'connection_limit'
          ? 16
          : key === 'connect_timeout'
            ? 30
            : key === 'pool_timeout'
              ? 60
              : undefined;
      if (
        !maximum ||
        !/^[1-9]\d*$/.test(parameter) ||
        !Number.isSafeInteger(Number(parameter)) ||
        Number(parameter) > maximum
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
