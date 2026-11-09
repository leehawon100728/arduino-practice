import type { Problem, SensorId } from '../types'
import { getSensor } from '../data/sensors'
import { SimBoard, defaultValues, type SerialChunk } from '../sim/board'
import type { Circuit } from '../sim/parts'
import type { CompileResult, Runner } from '../interp/compiler'

// ─────────────────────────────────────────────────────────────
// 동작 검사용 실행 환경: 센서 값을 바꿔 가며 일정 시간 실행하고
// LED 핀 출력과 시리얼 출력을 모은다.
// ─────────────────────────────────────────────────────────────

export const pinNum = (pin: string) => (pin.startsWith('A') ? 14 + Number(pin.slice(1)) : Number(pin.slice(1)))

export interface LedStat { avg: number; toggles: number }
export interface WindowResult {
  values: Record<string, number>
  leds: LedStat[]
  sig: string[]
  serial: SerialChunk[]
  error: string | null
}

export type SensorState = Record<string, number>

/** 센서 하나의 테스트 상태 목록 (컨트롤별 testValues, 나머지는 기본값) */
export function sensorStates(id: SensorId): SensorState[] {
  const s = getSensor(id)
  const out: SensorState[] = []
  if (id === 'dht11') {
    const t = s.controls[0]
    const h = s.controls[1]
    for (const v of t.testValues) out.push({ [`dht11.${t.key}`]: v, [`dht11.${h.key}`]: h.default })
    for (const v of [h.testValues[0], h.testValues[h.testValues.length - 1]]) out.push({ [`dht11.${t.key}`]: t.default, [`dht11.${h.key}`]: v })
    return out
  }
  for (const c of s.controls) for (const v of c.testValues) out.push({ [`${id}.${c.key}`]: v })
  return out
}

export function ledSig(l: LedStat): string {
  if (l.toggles >= 2) return 'B'
  if (l.avg < 0.04) return '0'
  if (l.avg > 0.96) return '1'
  return `p${Math.round(l.avg * 16)}`
}

export class Harness {
  board: SimBoard
  runner: Runner
  ledPins: number[]

  constructor(compiled: CompileResult, circuit: Circuit, problem: Problem, initial: Record<string, number> = {}) {
    this.board = new SimBoard(circuit, { ...defaultValues(), ...initial })
    this.runner = compiled.createRunner!(this.board)
    this.board.now = () => this.runner.ctx.time
    this.ledPins = problem.leds.map((l) => pinNum(l.pin))
  }

  get time() { return this.runner.ctx.time }

  /** 값 설정 → settle 동안 실행 → measure 동안 실행하며 측정 */
  window(values: Record<string, number>, settleMs: number, measureMs: number, stepCap = 120000): WindowResult {
    for (const [k, v] of Object.entries(values)) this.board.setValue(k, v)
    const r = this.runner
    r.run(this.time + settleMs * 1000, stepCap)
    const t0 = this.time
    const serialStart = this.board.serialOut.length
    r.run(t0 + measureMs * 1000, stepCap * 2)
    const t1 = Math.max(this.time, t0 + 1)
    const leds = this.ledPins.map((pin) => this.ledStat(pin, t0, t1))
    return {
      values: { ...this.board.values },
      leds,
      sig: leds.map(ledSig),
      serial: this.board.serialOut.slice(serialStart),
      error: r.error ? `${r.error.line}번째 줄: ${r.error.message}` : null,
    }
  }

  run(ms: number, stepCap = 400000) {
    this.runner.run(this.time + ms * 1000, stepCap)
  }

  ledStat(pin: number, t0: number, t1: number): LedStat {
    const ev = this.board.events
    let level = 0
    // t0 직전 값 찾기
    let i = 0
    for (; i < ev.length && ev[i].t <= t0; i++) if (ev[i].pin === pin) level = ev[i].value
    let area = 0
    let last = t0
    let toggles = 0
    let prevOn = level > 0
    for (; i < ev.length && ev[i].t <= t1; i++) {
      const e = ev[i]
      if (e.pin !== pin) continue
      area += (level / 255) * (e.t - last)
      last = e.t
      level = e.value
      const on = level > 0
      if (on !== prevOn) toggles++
      prevOn = on
    }
    area += (level / 255) * (t1 - last)
    return { avg: area / (t1 - t0), toggles }
  }
}

export function serialText(chunks: SerialChunk[]) {
  return chunks.map((c) => c.text).join('')
}
