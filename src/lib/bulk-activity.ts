const titles: Record<string, string> = {
  'bulk.askingPrice_updated': 'Bulk asking prices updated',
  'bulk.acquisitionCost_updated': 'Bulk acquisition costs updated',
  'bulk.renewalCost_updated': 'Bulk renewal costs updated',
  'bulk.registrar_updated': 'Bulk registrar details updated',
  'bulk.status_updated': 'Bulk domain statuses updated',
  'bulk.nameservers_updated': 'Bulk nameservers updated',
  'bulk.deleted': 'Bulk domains removed',
};

export const bulkActivityActions = Object.keys(titles);

export function bulkActivity(action: string, detail: unknown) {
  const title = titles[action];
  if (!title || !detail || typeof detail !== 'object' || !('count' in detail) ||
      typeof detail.count !== 'number' || !Number.isSafeInteger(detail.count) || detail.count < 1)
    return null;
  const count = detail.count;
  const names = 'domains' in detail && Array.isArray(detail.domains)
    ? detail.domains.filter((name): name is string => typeof name === 'string').slice(0, Math.min(count, 3))
    : [];
  const remaining = count - names.length;
  return {
    title,
    label: `${title} · ${count.toLocaleString('en-US')} ${count === 1 ? 'domain' : 'domains'}`,
    preview: names.length
      ? `${names.join(', ')}${remaining ? ` and ${remaining.toLocaleString('en-US')} more` : ''}`
      : null,
  };
}
