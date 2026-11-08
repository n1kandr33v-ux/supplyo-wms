import { useEffect, useRef } from 'react'

export const REFRESH_INTERVAL_MS = 60 * 60 * 1000

/** Refresh while open; catch up once after a suspended/background tab wakes. */
export function useHourlyRefresh(lastUpdated: string, refresh: () => Promise<void>) {
  const latestRefresh = useRef(refresh)
  useEffect(() => { latestRefresh.current = refresh }, [refresh])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const state = { completedAt: Date.parse(lastUpdated) || Date.now(), running: false, stopped: false }
    const schedule = () => {
      if (!state.stopped) timer = setTimeout(check, Math.max(0, state.completedAt + REFRESH_INTERVAL_MS - Date.now()))
    }
    const check = async () => {
      if (state.stopped || state.running || Date.now() - state.completedAt < REFRESH_INTERVAL_MS) return
      clearTimeout(timer)
      state.running = true
      try { await latestRefresh.current() }
      finally { state.completedAt = Date.now(); state.running = false; schedule() }
    }
    const wake = () => { if (document.visibilityState === 'visible') void check() }
    schedule()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      state.stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
    }
  }, [lastUpdated])
}
