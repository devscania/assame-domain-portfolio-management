import { brand } from './brand';

function html(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

/** All transactional emails share branding and an inline light-theme fallback.
 * Clients supporting prefers-color-scheme can also use the dark palette.
 * Callers supply plain text; dynamic content and action URLs are escaped here.
 */
export function transactionalEmail({
  heading,
  paragraphs,
  action,
  footer = [],
}: {
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: URL };
  footer?: string[];
}) {
  if (action && !['https:', 'http:'].includes(action.url.protocol))
    throw new Error('Invalid transactional email action URL');
  const paragraph = (text: string) =>
    `<p style="margin:0 0 18px;line-height:1.6">${html(text)}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${html(heading)}</title><style>@media(prefers-color-scheme:dark){.email-background{background:#101713!important}.email-surface{background:#19231d!important;color:#f3f7f4!important}.email-brand{color:#35c46a!important}.email-muted{color:#a7b5aa!important}.email-action{background:#35c46a!important;color:#101713!important}}</style></head><body class="email-background" style="margin:0;padding:24px 12px;background:#f5f7f5;font-family:Arial,sans-serif;color:#111827"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td align="center"><table role="presentation" class="email-surface" style="width:100%;max-width:560px;background:#ffffff;border-radius:12px;color:#111827"><tr><td style="padding:28px 24px"><div class="email-brand" style="color:#15803d;font-size:22px;font-weight:700;margin-bottom:24px">${html(brand.name)}</div><h1 style="font-size:24px;line-height:1.3;margin:0 0 20px">${html(heading)}</h1>${paragraphs.map(paragraph).join('')}${action ? `<p style="margin:24px 0"><a class="email-action" style="display:inline-block;max-width:100%;box-sizing:border-box;background:#15803d;color:#ffffff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:600;line-height:1.4" href="${html(action.url.toString())}">${html(action.label)}</a></p>` : ''}<div class="email-muted" style="font-size:14px;color:#64748b">${footer.map(paragraph).join('')}${paragraph(brand.tagline)}</div></td></tr></table></td></tr></table></body></html>`;
}
