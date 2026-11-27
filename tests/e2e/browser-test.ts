import { test as base, expect } from '@playwright/test';
import { browserOrigin } from './environment';

/** Provider and analytics responses must be mocked explicitly by each test.
 * Page routes take precedence over this context-level external-network denial.
 */
export const test = base.extend({
  context: async ({ context }, provideContext) => {
    await context.route('**/*', async (route) => {
      const target = new URL(route.request().url());
      if (target.origin === browserOrigin || ['data:', 'blob:'].includes(target.protocol))
        await route.continue();
      else await route.abort('blockedbyclient');
    });
    await provideContext(context);
  },
});
export { expect };
