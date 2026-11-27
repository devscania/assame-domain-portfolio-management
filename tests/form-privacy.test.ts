import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactElement } from 'react';
import { AppearanceProvider } from '../src/components/appearance';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { LoginForm } from '../src/components/login-form';
import { AuthEmailForm } from '../src/components/auth-email-form';

function renderAuthentication(element: ReactElement) {
  return renderToStaticMarkup(createElement(AppearanceProvider, null, element));
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(directory, entry.name))
      : entry.name.endsWith('.tsx')
        ? [join(directory, entry.name)]
        : [],
  );
}

describe('native form privacy before client hydration', () => {
  it('requires an explicit POST fallback for every native form with a client submit handler', () => {
    const violations: string[] = [];
    let checked = 0;
    for (const path of sourceFiles('src')) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      function visit(node: ts.Node) {
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          node.tagName.getText(source) === 'form'
        ) {
          const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
          if (attributes.some((attribute) => attribute.name.getText(source) === 'onSubmit')) {
            checked++;
            const method = attributes.find(
              (attribute) => attribute.name.getText(source) === 'method',
            )?.initializer;
            if (!method || !ts.isStringLiteral(method) || method.text.toLowerCase() !== 'post')
              violations.push(
                `${path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
              );
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(checked).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it('renders POST authentication forms with inert submit and OAuth controls until hydration', () => {
    const markup = [
      renderAuthentication(
        createElement(LoginForm, {
          demo: false,
          brand: 'Assame',
          providers: ['google', 'discord'],
        }),
      ),
      renderAuthentication(
        createElement(LoginForm, { demo: false, brand: 'Assame', initialRegister: true }),
      ),
      ...(['forgot', 'verify', 'reset'] as const).map((mode) =>
        renderAuthentication(
          createElement(AuthEmailForm, {
            mode,
            token: mode === 'reset' ? 'synthetic-token' : undefined,
          }),
        ),
      ),
    ];
    for (const html of markup) {
      expect(html).toMatch(/<form\b[^>]*method="post"/);
      const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
      expect(buttons.length).toBeGreaterThan(0);
      expect(buttons.every((button) => /\bdisabled(?:=|\s|>)/.test(button))).toBe(true);
      expect(html).toContain('<noscript>');
    }
  });
});
