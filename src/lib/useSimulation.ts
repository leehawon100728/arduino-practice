import { useCallback, useEffect, useRef, useState } from 'react'
import { compileSource, type Diagnostic, type Runner } from '../interp/compiler'
import { SimBoard, type BoardSnapshot } from '../sim/board'
import type { Circuit } from '../sim/parts'

// ─────────────────────────────────────────────────────────────
// 화면용 실시간 실행: requestAnimationFrame 마다 실제 흐른 시간만큼
// 가상 시간을 진행한다. 한 프레임 작업량을 제한해서 화면이 멈추지 않는다.
// ─────────────────────────────────────────────────────────────

const MAX_STEPS_PER_FRAME = 250_000
const MAX_RUN_MS = 30 * 60 * 1000

export interface SimState {
  running: boolean
  snapshot: BoardSnapshot | null
  serial: string[]
  runtimeError: Diagnostic | null
  compileErrors: Diagnostic[]
  slow: boolean
  virtualMs: number
}

export function useSimulation(opts: { code: string; circuit: Circuit; values: Record<string, number>; irActiveLow: boolean }) {
  const [state, setState] = useState<SimState>({ running: false, snapshot: null, serial: [], runtimeError: null, compileErrors: [], slow: false, virtualMs: 0 })
  const boardRef = useRef<SimBoard | null>(null)
  const runnerRef = useRef<Runner | null>(null)
  const rafRef = useRef<number | null>(null)
  const serialBuf = useRef<string>('')
  const linesRef = useRef<string[]>([])
  const latest = useRef(opts)
  latest.current = opts

  const stop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    runnerRef.current?.stop()
    runnerRef.current = null
    boardRef.current = null
    setState((s) => ({ ...s, running: false, snapshot: null, slow: false }))
  }, [])

  const start = useCallback(() => {
    stop()
    const { code, circuit, values, irActiveLow } = latest.current
    const compiled = compileSource(code)
    if (!compiled.ok) {
      setState((s) => ({ ...s, compileErrors: compiled.errors, runtimeError: null }))
      return false
    }
    const board = new SimBoard(circuit, values, { irActiveLow })
    board.recordEvents = false
    const runner = compiled.createRunner!(board)
    board.now = () => runner.ctx.time
    linesRef.current = []
    serialBuf.current = ''
    board.onSerial = (t) => { serialBuf.current += t }
    boardRef.current = board
    runnerRef.current = runner
    const t0 = performance.now()
    let frame = 0
    const tick = () => {
      const now = performance.now()
      const elapsedMs = now - t0
      const target = elapsedMs * 1000
      const status = runner.run(target, MAX_STEPS_PER_FRAME)
      const slow = target - runner.ctx.time > 1_000_000
      // 시리얼 버퍼 → 줄
      if (serialBuf.current) {
        const parts = serialBuf.current.split(/\r?\n/)
        const lines = linesRef.current
        if (lines.length === 0) lines.push('')
        lines[lines.length - 1] += parts[0]
        for (let i = 1; i < parts.length; i++) lines.push(parts[i])
        if (lines.length > 400) lines.splice(0, lines.length - 400)
        serialBuf.current = ''
      }
      if (frame++ % 2 === 0 || status !== 'running') {
        setState((s) => ({
          ...s,
          running: status === 'running',
          snapshot: board.snapshot(),
          serial: [...linesRef.current],
          runtimeError: runner.error ? { line: runner.error.line, message: runner.error.message } : null,
          compileErrors: [],
          slow,
          virtualMs: runner.ctx.time / 1000,
        }))
      }
      if (status === 'running' && elapsedMs < MAX_RUN_MS) rafRef.current = requestAnimationFrame(tick)
      else rafRef.current = null
    }
    setState((s) => ({ ...s, running: true, serial: [], runtimeError: null, compileErrors: [], snapshot: board.snapshot() }))
    rafRef.current = requestAnimationFrame(tick)
    return true
  }, [stop])

  // 실행 중 센서 값 / 회로가 바뀌면 바로 반영
  useEffect(() => {
    const b = boardRef.current
    if (!b) return
    for (const [k, v] of Object.entries(opts.values)) b.setValue(k, v)
  }, [opts.values])
  useEffect(() => { boardRef.current?.setCircuit(opts.circuit) }, [opts.circuit])
  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }, [])

  const sendSerial = useCallback((text: string) => { boardRef.current?.sendSerial(text) }, [])
  const clearSerial = useCallback(() => { linesRef.current = []; setState((s) => ({ ...s, serial: [] })) }, [])

  return { ...state, start, stop, sendSerial, clearSerial }
}
