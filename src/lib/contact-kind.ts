export const contactKinds = ['contact', 'bug', 'feature'] as const;
export type ContactKind = (typeof contactKinds)[number];
export const contactKindLabels: Record<ContactKind, string> = {
  contact: 'General question',
  bug: 'Report a bug',
  feature: 'Request a feature',
};
