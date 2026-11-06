import type { ReactNode } from 'react'
import { useDelayedLoading } from '@/hooks/use-delayed-loading'

/** Keeps forms mounted and preserves dimensions while replacing busy content. */
export function LoadingBoundary({ loading, fallback, children, label = 'Загрузка данных', className = '' }: {
  loading: boolean; fallback: ReactNode; children: ReactNode; label?: string; className?: string
}) {
  const visible = useDelayedLoading(loading)
  return <div className={`loading-boundary ${className}`} aria-busy={loading}>
    <div className="loading-content" data-loading={visible || undefined} inert={loading || undefined} aria-hidden={visible || undefined}>{children}</div>
    {visible && <div className="loading-placeholder"><span className="sr-only" role="status">{label}</span>{fallback}</div>}
  </div>
}
