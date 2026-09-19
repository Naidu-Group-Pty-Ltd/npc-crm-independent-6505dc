/**
 * Interleaves a recency-sorted feed so no single publisher owns the top of the page.
 *
 * A general-news source posts far more often than a specialist one, so strict recency
 * ordering let one masthead take ~30% of the feed and most of the first screen. This
 * walks the sources round-robin — newest unshown item from each in turn — which keeps
 * every item and their relative recency within a source, while guaranteeing the first
 * N cards come from N different publishers wherever the data allows.
 */
export function interleaveBySource<T>(items: readonly T[], sourceOf: (item: T) => string): T[] {
  if (items.length < 2) return [...items];

  const queues = new Map<string, T[]>();
  for (const item of items) {
    const key = sourceOf(item) || 'unknown';
    const queue = queues.get(key);
    if (queue) queue.push(item);
    else queues.set(key, [item]);
  }
  // A single publisher needs no interleaving.
  if (queues.size < 2) return [...items];

  // Source order follows first appearance, so the most recent item overall still leads.
  const order = [...queues.keys()];
  const out: T[] = [];
  while (out.length < items.length) {
    let placedThisPass = false;
    for (const key of order) {
      const queue = queues.get(key);
      if (!queue?.length) continue;
      out.push(queue.shift() as T);
      placedThisPass = true;
    }
    // Defensive: every queue empty means we are done, and prevents an infinite loop
    // if the caller hands us something unexpected.
    if (!placedThisPass) break;
  }
  return out;
}
