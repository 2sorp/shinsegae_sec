export const seoulDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const isPinned = (entry, date) => !entry.closedAt && entry.kind === '고정' && entry.pinStart <= date && date <= entry.pinEnd;
export function selectEntries(entries, tab, filters, date) {
  return entries.filter(entry => Boolean(entry.closedAt) === (tab === 'closed')
    && (!filters.date || entry.date === filters.date)
    && (!filters.shift || entry.shift === filters.shift)
    && (!filters.kind || entry.kind === filters.kind)
    && (!filters.tag || entry.tags.includes(filters.tag))
    && [entry.title, entry.content, entry.issues, entry.author, ...entry.tags.map(tag => `#${tag}`)].join(' ').toLowerCase().includes(filters.query.toLowerCase()))
    .sort((a, b) => Number(isPinned(b, date)) - Number(isPinned(a, date))
      || (tab === 'closed' ? b.closedAt.localeCompare(a.closedAt) : b.date.localeCompare(a.date))
      || b.createdAt.localeCompare(a.createdAt));
}
