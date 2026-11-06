export type StatusSort = 'address' | 'attention' | 'ready'
type SortableOrder = { id: number; address: string; ready: boolean; assemblyStatus?: 'waiting' | 'checking' | 'ready' | 'error' | 'kiz-error' }
const priority = { error: 0, 'kiz-error': 1, waiting: 2, checking: 3, ready: 4 }
export function sortOrders<T extends SortableOrder>(orders: T[], mode: StatusSort): T[] {
  return [...orders].sort((a,b)=>{
    if (mode !== 'address') {
      const delta = priority[a.assemblyStatus ?? (a.ready ? 'ready' : 'waiting')] - priority[b.assemblyStatus ?? (b.ready ? 'ready' : 'waiting')]
      if (delta) return mode === 'ready' ? -delta : delta
    }
    return a.address.localeCompare(b.address, 'ru', { numeric: true }) || a.id-b.id
  })
}
