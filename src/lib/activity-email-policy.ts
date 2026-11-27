export const activityEmailOptions = {
  activityBulkEmails: 'Bulk edits and removals',
  activityPriceEmails: 'Marketplace price updates',
  activitySyncEmails: 'Manual provider syncs',
} as const;
export type ActivityEmailPreferences = Record<keyof typeof activityEmailOptions, boolean>;
export const defaultActivityEmailPreferences: ActivityEmailPreferences = {
  activityBulkEmails: true,
  activityPriceEmails: true,
  activitySyncEmails: true,
};
export const activityEmailPreferenceByCategory = {
  bulk: 'activityBulkEmails',
  price: 'activityPriceEmails',
  sync: 'activitySyncEmails',
} as const;
export type ActivityEmailCategory = keyof typeof activityEmailPreferenceByCategory | 'other';

export function allowsActivityEmail(
  preferences: Partial<ActivityEmailPreferences> | null | undefined,
  category: string,
) {
  if (!Object.hasOwn(activityEmailPreferenceByCategory, category)) return true;
  return (
    preferences?.[
      activityEmailPreferenceByCategory[category as keyof typeof activityEmailPreferenceByCategory]
    ] !== false
  );
}
