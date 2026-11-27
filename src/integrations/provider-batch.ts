import { z } from 'zod';
import { actionInput } from './actions';
import { providerBatchLimit } from './provider-batch-options';

export const providerBatchInput = z.object({
  items: z.array(actionInput).min(1).max(providerBatchLimit),
}).superRefine(({ items }, ctx) => {
  const first = items[0];
  if (first && (first.action === 'removeListing' ||
    items.some((item) => item.action !== first.action) ||
    new Set(items.map((item) => item.domainId)).size !== items.length)) {
    ctx.addIssue({ code: 'custom', message: 'Choose one supported action per batch and unique domains.' });
  }
});
