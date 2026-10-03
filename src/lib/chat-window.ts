/** Keep whole turns at ordinary page boundaries; cap an oversized single turn. */
export function boundChatWindow<T extends { role?: string }>(items: T[], direction: 'older' | 'newer', limit = 400): { messages: T[]; offset: number } {
  if (items.length <= limit) return { messages: items, offset: 0 };
  if (direction === 'older') {
    let end = limit;
    while (end > 0 && items[end]?.role !== 'user') end--;
    return { messages: items.slice(0, end || limit), offset: 0 };
  }
  let start = items.length - limit;
  while (start < items.length && items[start]?.role !== 'user') start++;
  if (start === items.length) start = items.length - limit;
  return { messages: items.slice(start), offset: start };
}
