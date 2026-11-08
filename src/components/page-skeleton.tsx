import type { CSSProperties, ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useDelayedLoading } from '@/hooks/use-delayed-loading'

type Props = { section: string; accountSection?: string }
function CardPlaceholder({ children }: { children: ReactNode }) {
  return <div className="skeleton-card">{children}</div>
}
function Metrics({ count = 4 }: { count?: number }) {
  return <div className="skeleton-metrics" style={{ '--skeleton-columns': count } as CSSProperties}>
    {Array.from({ length: count }, (_,i)=><CardPlaceholder key={i}><Skeleton className="skeleton-label"/><Skeleton className="skeleton-number"/></CardPlaceholder>)}
  </div>
}
function Toolbar() {
  return <div className="skeleton-toolbar"><Skeleton className="skeleton-search"/><Skeleton className="skeleton-control"/><Skeleton className="skeleton-control"/></div>
}
export function TableSkeleton({ columns = 6, rows = 6 }: { columns?: number; rows?: number }) {
  return <div className="skeleton-table" style={{ '--skeleton-columns': columns } as CSSProperties}>
    <div className="skeleton-table-row skeleton-table-head">{Array.from({length:columns},(_,i)=><Skeleton key={i} className="skeleton-label"/>)}</div>
    {Array.from({length:rows},(_,row)=><div className="skeleton-table-row" key={row}>{Array.from({length:columns},(_,col)=><div className="skeleton-cell" key={col}><Skeleton className={col===0?'skeleton-cell-title':'skeleton-cell-line'}/>{col===0&&<Skeleton className="skeleton-cell-caption"/>}</div>)}</div>)}
  </div>
}
export function FormSkeleton() {
  return <div className="skeleton-form">{Array.from({length:3},(_,i)=><div key={i}><Skeleton className="skeleton-label"/><Skeleton className="skeleton-field"/></div>)}</div>
}
export function PageSkeleton({ section, accountSection }: Props) {
  const accounting = section === 'profile' && accountSection === 'accounting'
  return <div className="page-skeleton" aria-hidden="true">
    {section==='overview'?<><Metrics/><CardPlaceholder><Skeleton className="skeleton-heading"/><Skeleton className="skeleton-description"/><Metrics count={2}/></CardPlaceholder></>
    :section==='settings'?<CardPlaceholder><Skeleton className="skeleton-heading"/><Skeleton className="skeleton-description"/><FormSkeleton/><Toolbar/></CardPlaceholder>
    :section==='profile'&&!accounting?accountSection==='warehouses'?<><Skeleton className="skeleton-heading"/><CardPlaceholder><Skeleton className="skeleton-heading"/><FormSkeleton/></CardPlaceholder></>:<CardPlaceholder>{Array.from({length:2},(_,section)=><div className="skeleton-profile-section" key={section}><Skeleton className="skeleton-heading"/>{Array.from({length:section?2:5},(_,row)=><div className="skeleton-profile-row" key={row}><Skeleton className="skeleton-label"/><Skeleton className="skeleton-cell-title"/><Skeleton className="skeleton-control"/></div>)}</div>)}</CardPlaceholder>
    :accounting?<><Skeleton className="skeleton-heading"/><Toolbar/><Metrics count={3}/><CardPlaceholder><Skeleton className="skeleton-heading"/><TableSkeleton/></CardPlaceholder></>
    :<CardPlaceholder><Skeleton className="skeleton-heading"/>{section==='stocks'&&<Metrics count={2}/>}<Toolbar/><TableSkeleton columns={section==='supplies'?9:section==='assembly'?7:section==='stocks'?5:6}/></CardPlaceholder>}
  </div>
}
/** Lazy module fallback; no artificial minimum loading duration. */
export function DeferredPageSkeleton(props: Props) {
  const visible = useDelayedLoading(true)
  return <div aria-busy="true" className="deferred-page-skeleton">{visible&&<><span role="status" className="sr-only">Загрузка раздела</span><PageSkeleton {...props}/></>}</div>
}
