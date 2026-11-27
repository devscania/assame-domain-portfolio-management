export function isAtomApproved(status: string) {
  return ['approved', 'seller approved'].includes(status.trim().toLowerCase());
}

export function listingNeedsReview(status: string) {
  return ['pending', 'unverified', 'requires_verification', 'review'].includes(status.trim().toLowerCase());
}

export function canEditListingPrice(provider: string, status: string) {
  return (
    ['active', 'listed', 'onsale'].includes(status.trim().toLowerCase()) ||
    (provider === 'atom' && isAtomApproved(status))
  );
}

export function listingStatusLabel(marketplace: string, status: string) {
  if (marketplace === 'atom' && isAtomApproved(status)) return 'Approved';
  if (['active', 'listed', 'onsale'].includes(status.trim().toLowerCase())) return 'Listed';
  return status;
}
