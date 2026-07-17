/**
 * Shared shop-key filtering for webhook events.
 *
 * Events saved before shopKey existed have shopKey '' or missing; those
 * legacy events are treated as 'meit' (the only shop at that time).
 */

/** Mongo filter fragment restricting events to one shop. Merge into a find() filter. */
export function mongoShopKeyFilter(shopKey: string): Record<string, unknown> {
  if (shopKey === 'meit') {
    return { $or: [{ shopKey }, { shopKey: '' }, { shopKey: { $exists: false } }] };
  }
  return { shopKey };
}

/** In-memory equivalent of mongoShopKeyFilter. */
export function eventMatchesShopKey(
  eventShopKey: string | undefined,
  shopKey: string
): boolean {
  return (eventShopKey || 'meit') === shopKey;
}
