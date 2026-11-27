import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { AccountRemovalControls } from '../src/components/account-removal-controls';
describe('account removal controls remain reachable after settings separation', () => {
  it('keeps password confirmation and explicit POST for password accounts', () => {
    const html = renderToStaticMarkup(createElement(AccountRemovalControls, { hasPassword: true }));
    expect(html).toContain('method="post"');
    expect(html).toContain('Type DELETE ACCOUNT');
    expect(html).toContain('Permanently remove account');
    expect(html).not.toContain('Email removal link');
  });
  it('offers the session-bound email flow instead of a nonexistent password for OAuth-only accounts', () => {
    const html = renderToStaticMarkup(
      createElement(AccountRemovalControls, { hasPassword: false }),
    );
    expect(html).toContain('Email removal link for OAuth-only account');
    expect(html).not.toContain('name="currentPassword"');
  });
});
