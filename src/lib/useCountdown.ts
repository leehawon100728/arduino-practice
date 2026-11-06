import { useEffect, useRef, useState } from 'react'

/** 남은 초를 돌려준다. limit 이 null 이면 경과 시간(초)을 센다. */
export function useCountdown(limitSec: number | null, running: boolean, onExpire?: () => void) {
  const [elapsed, setElapsed] = useState(0)
  const expired = useRef(false)
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [running])
  const remaining = limitSec == null ? null : Math.max(0, limitSec - elapsed)
  useEffect(() => {
    if (remaining === 0 && !expired.current) {
      expired.current = true
      onExpire?.()
    }
  }, [remaining, onExpire])
  return { elapsed, remaining }
}

export const fmtTime = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
