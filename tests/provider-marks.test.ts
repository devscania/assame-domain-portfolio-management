import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { Providers } from '../src/components/providers';
import { LoginForm } from '../src/components/login-form';
describe('provider sign-in presentation', () => {
  it('includes distinct decorative marks with named, hydration-safe provider buttons', () => {
    const html = renderToStaticMarkup(
      createElement(
        Providers,
        null,
        createElement(LoginForm, {
          brand: 'Assame',
          demo: false,
          providers: ['google', 'discord'],
        }),
      ),
    );
    expect(html.match(/class="provider-icon/g)).toHaveLength(2);
    expect(html).toContain('Continue with Google');
    expect(html).toContain('Continue with Discord');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('<select');
    expect(html).toContain('data-theme-choice="system"');
  });
});
