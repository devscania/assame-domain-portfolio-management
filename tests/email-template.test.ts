import { describe, expect, it } from 'vitest';
import { transactionalEmail } from '../src/lib/email-template';

describe('transactional email rendering', () => {
  it('escapes content and action attributes without losing token query parameters', () => {
    const result = transactionalEmail({
      heading: 'Review <script>"change"</script>',
      paragraphs: ['A & B', '<img src=x onerror=alert(1)>'],
      action: {
        label: 'Confirm "change"',
        url: new URL('https://example.test/confirm?token=abc&reason=account'),
      },
      footer: ["Don't share this link."],
    });
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;script&gt;&quot;change&quot;&lt;/script&gt;');
    expect(result).toContain('href="https://example.test/confirm?token=abc&amp;reason=account"');
  });
  it('rejects action protocols that cannot be safe navigation links', () => {
    expect(() =>
      transactionalEmail({
        heading: 'Confirm',
        paragraphs: [],
        action: { label: 'Continue', url: new URL('javascript:alert(1)') },
      }),
    ).toThrow('Invalid transactional email action URL');
  });
});
