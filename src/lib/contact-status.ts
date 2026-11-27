export const contactStatuses = ['new', 'in_progress', 'resolved'] as const;
export type ContactStatus = (typeof contactStatuses)[number];
export const contactStatusLabels: Record<ContactStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  resolved: 'Resolved',
};
