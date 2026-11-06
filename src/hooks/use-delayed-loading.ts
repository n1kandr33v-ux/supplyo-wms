import { useEffect, useMemo, useState } from 'react'

/** Each request owns its placeholder, so a previous request cannot flash it. */
export function useDelayedLoading(loading: boolean, delay = 150) {
  const request = useMemo(() => ({ loading, delay }), [loading, delay])
  const [visibleRequest, setVisibleRequest] = useState<typeof request | null>(null)
  useEffect(() => {
    if (!request.loading) return
    const timer = setTimeout(() => setVisibleRequest(request), request.delay)
    return () => clearTimeout(timer)
  }, [request])
  return loading && visibleRequest === request
}
