import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
export async function chooseTheme(page: Page, theme: 'light' | 'dark' | 'system') {
  const button = page.getByRole('button', { name: /^Theme:/ }).first();
  await expect(button).toBeEnabled();
  for (let i = 0; i < 3 && (await button.getAttribute('data-theme-choice')) !== theme; i++) {
    await button.click();
  }
  await expect(button).toHaveAttribute('data-theme-choice', theme);
  if (theme !== 'system') await expect(page.locator('html')).toHaveClass(new RegExp(theme));
}
