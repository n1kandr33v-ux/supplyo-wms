import type { ComponentProps } from 'react'
import { Check } from 'lucide-react'
import { Badge } from './badge'

/** Shared success status: solid green surface and white label/check. */
export function SuccessBadge({ children, className = '', ...props }: ComponentProps<typeof Badge>) {
  return <Badge {...props} variant="outline" className={`status-ready ${className}`}><Check size={12} aria-hidden="true" />{children}</Badge>
}
