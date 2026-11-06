import { useEffect, useRef, useState } from 'react'

export default function SerialMonitor({ lines, onSend, onClear }: {
  lines: string[]; onSend?: (text: string) => void; onClear: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  useEffect(() => {
    if (autoScroll && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines, autoScroll])
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (input) { onSend?.(input); setInput('') } }}>
        <label htmlFor="serial-in" className="sr-only">시리얼 입력</label>
        <input id="serial-in" value={input} onChange={(e) => setInput(e.target.value)} placeholder="보낼 내용"
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900" />
        <button type="submit" className="btn-ghost py-1">전송</button>
        <button type="button" className="btn-ghost py-1" onClick={onClear}>지우기</button>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />자동 스크롤</label>
      </form>
      <div ref={box} role="log" aria-live="polite" aria-label="시리얼 모니터 출력"
        className="min-h-24 flex-1 overflow-auto rounded-md bg-slate-900 p-2 font-mono text-xs whitespace-pre text-emerald-300">
        {lines.length ? lines.join('\n') : <span className="text-slate-500">9600 baud · ▶ 시작을 누르면 출력이 여기에 나와요</span>}
      </div>
    </div>
  )
}
