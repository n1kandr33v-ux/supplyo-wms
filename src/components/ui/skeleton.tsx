import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Decorative placeholder; its enclosing loading region owns announcements. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} data-slot="skeleton" aria-hidden="true" className={cn('skeleton', className)} />
}
