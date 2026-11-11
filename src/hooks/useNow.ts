import { useEffect, useState } from 'react'

/** Returns the current time, re-rendering every `intervalMs` milliseconds (default 1 s). */
export const useNow = (intervalMs = 1000): Date => {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return now
}
