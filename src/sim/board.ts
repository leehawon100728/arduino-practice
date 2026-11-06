import type { Circuit } from './parts'
import { Netlist, PART_DEFS, isLed, isResistor } from './parts'
import { pinNumberToNode } from './geometry'
import { solveCircuit, type PinMode, type PinState, type SolveResult } from './solver'
import { SENSOR_MAP } from '../data/sensors'

// ─────────────────────────────────────────────────────────────
// 가상 아두이노 보드: 해석기(interp)가 부르는 하드웨어 함수 모음
// ─────────────────────────────────────────────────────────────

export interface Hardware {
  pinMode(pin: number, mode: PinMode): void
  digitalWrite(pin: number, v: number): void
  digitalRead(pin: number): number
  analogRead(pin: number): number
  analogWrite(pin: number, v: number): void
  /** µs 단위 펄스 길이와 기다린 시간 */
  pulseIn(pin: number, level: number, timeoutUs: number): { value: number; waitedUs: number }
  dhtRead(pin: number): { ok: boolean; temperature: number; humidity: number }
  serialBegin(baud: number): void
  serialWrite(text: string): void
  serialAvailable(): number
  serialRead(): number
  warn(key: string, msg: string): void
}

export interface PinEvent { t: number; pin: number; value: number }
export interface SerialChunk { t: number; text: string }

export interface BoardSnapshot {
  leds: Record<string, { brightness: number; burnt: boolean; reversed: boolean }>
  builtin: number
  modules: Record<string, { powered: boolean; reversed: boolean }>
  warnings: string[]
  pins: PinState[]
}

const freshPins = (): PinState[] => Array.from({ length: 20 }, () => ({ mode: 'INPUT' as PinMode, level: 0 as 0 | 1, pwm: null }))

export class SimBoard implements Hardware {
  circuit: Circuit
  values: Record<string, number>
  irActiveLow: boolean
  pins: PinState[] = freshPins()
  burnt = new Set<string>()
  warnings = new Map<string, string>()
  /** 핀 출력 기록 (채점용). value 0~255 */
  events: PinEvent[] = []
  serialOut: SerialChunk[] = []
  serialStarted = false
  serialIn: number[] = []
  /** 핀별 마지막 HIGH 시작/끝 시각 (µs) — 초음파 Trig 감지용 */
  private pulse = new Map<number, { rise: number; fall: number }>()
  private lastRec = new Map<number, number>()
  private rec(pin: number, value: number) {
    if (!this.recordEvents || this.lastRec.get(pin) === value) return
    this.lastRec.set(pin, value)
    this.events.push({ t: this.now(), pin, value })
    if (this.events.length > 200000) this.events.splice(0, 50000)
  }
  private dhtLast = new Map<number, number>()
  private nets: { open: Netlist; pressed: Netlist } | null = null
  private cache: SolveResult | null = null
  now: () => number = () => 0
  recordEvents = true
  onSerial?: (text: string) => void

  constructor(circuit: Circuit, values: Record<string, number>, opts: { irActiveLow?: boolean } = {}) {
    this.circuit = circuit
    this.values = { ...values }
    this.irActiveLow = opts.irActiveLow ?? true
  }

  // ── 상태 변경 ──
  setCircuit(c: Circuit) { this.circuit = c; this.nets = null; this.cache = null }
  setValue(key: string, v: number) {
    if (this.values[key] === v) return
    this.values[key] = v
    this.cache = null
  }
  setValues(v: Record<string, number>) { this.values = { ...v }; this.cache = null }
  reset() {
    this.pins = freshPins()
    this.burnt.clear()
    this.warnings.clear()
    this.events = []
    this.serialOut = []
    this.serialStarted = false
    this.serialIn = []
    this.pulse.clear()
    this.lastRec.clear()
    this.dhtLast.clear()
    this.cache = null
  }

  private netlist() {
    if (!this.nets) this.nets = { open: new Netlist(this.circuit), pressed: new Netlist(this.circuit, { pressed: true }) }
    return (this.values['button.pressed'] ?? 0) === 1 ? this.nets.pressed : this.nets.open
  }

  solve(): SolveResult {
    if (this.cache) return this.cache
    const r = solveCircuit({ circuit: this.circuit, net: this.netlist(), pins: this.pins, values: this.values, irActiveLow: this.irActiveLow, burnt: this.burnt })
    this.cache = r
    if (r.short) this.warn('short', '5V 와 GND 가 바로 연결됐어요 (단락). 보드가 위험해요!')
    for (const [id, led] of r.leds) {
      if (led.current > 0.03 && !this.burnt.has(id)) {
        this.burnt.add(id)
        this.warn(`burn:${id}`, `LED 에 전류가 너무 많이 흘러 터졌어요 💥 (${Math.round(led.current * 1000)}mA). 220Ω 저항을 직렬로 연결하세요.`)
        this.cache = null
        return this.solve()
      }
      if (led.reversed) this.warn(`rev:${id}`, 'LED 극성이 반대예요. 긴 다리(+)가 핀 쪽, 짧은 다리(−)가 GND 쪽이어야 해요.')
    }
    for (const [pin, i] of r.pinCurrent) {
      if (Math.abs(i) > 0.04) this.warn(`oc:${pin}`, `D${pin} 핀에 ${Math.round(Math.abs(i) * 1000)}mA 가 흘러요. 디지털 핀은 40mA 를 넘으면 망가질 수 있어요.`)
    }
    for (const part of this.circuit.parts) {
      const m = r.modules.get(part.id)
      if (m?.reversed) this.warn(`modrev:${part.id}`, `${PART_DEFS[part.kind].label} 의 VCC 와 GND 가 반대로 연결됐어요.`)
    }
    return r
  }

  private invalidate() { this.cache = null }

  private pinVoltage(pin: number): number | null {
    const node = pinNumberToNode(pin)
    if (!node) return null
    const r = this.solve()
    const n = r.net.find(node)
    if (!r.v.has(n) || r.floating.has(n)) return null
    return r.v.get(n)!
  }

  private checkPin(pin: number) {
    if (pin === 0 || pin === 1) this.warn('d01', 'D0, D1 은 시리얼 통신용 핀이라 쓰지 않는 게 좋아요.')
  }

  // ── Hardware 구현 ──
  pinMode(pin: number, mode: PinMode) {
    this.checkPin(pin)
    const p = this.pins[pin]
    if (p.mode !== mode) { p.mode = mode; if (mode !== 'OUTPUT') { p.level = 0; p.pwm = null } this.invalidate() }
  }

  digitalWrite(pin: number, v: number) {
    this.checkPin(pin)
    const p = this.pins[pin]
    const level = (v ? 1 : 0) as 0 | 1
    if (p.mode !== 'OUTPUT') {
      // INPUT 에 HIGH 를 쓰면 내부 풀업이 켜진다 (아두이노 동작)
      if (p.mode === 'INPUT' && level) { p.mode = 'INPUT_PULLUP'; this.invalidate() }
      else if (p.mode === 'INPUT_PULLUP' && !level) { p.mode = 'INPUT'; this.invalidate() }
      this.warn(`nomode:${pin}`, `D${pin} 핀에 pinMode(${pin}, OUTPUT) 없이 digitalWrite 를 했어요.`)
      return
    }
    const t = this.now()
    if (level && !p.level) this.pulse.set(pin, { rise: t, fall: Infinity })
    if (!level && p.level) { const q = this.pulse.get(pin); if (q) q.fall = t }
    if (p.level !== level || p.pwm !== null) { p.level = level; p.pwm = null; this.invalidate() }
    this.rec(pin, level ? 255 : 0)
  }

  analogWrite(pin: number, v: number) {
    this.checkPin(pin)
    const p = this.pins[pin]
    const val = Math.max(0, Math.min(255, Math.round(v)))
    if (v > 255 || v < 0) this.warn(`aw:${pin}`, `analogWrite 값 ${v} 는 범위를 벗어났어요. 0~255 만 쓸 수 있어요.`)
    if (p.mode !== 'OUTPUT') { p.mode = 'OUTPUT'; this.invalidate() }
    const pwmPin = [3, 5, 6, 9, 10, 11].includes(pin)
    let eff: number | null = val
    if (!pwmPin) {
      this.warn(`pwm:${pin}`, `D${pin} 은 PWM(~) 핀이 아니라 analogWrite 가 HIGH/LOW 로만 동작해요.`)
      eff = null
      p.level = val >= 128 ? 1 : 0
    } else if (val === 0 || val === 255) {
      eff = null
      p.level = val === 255 ? 1 : 0
    }
    if (p.pwm !== eff || eff === null) { p.pwm = eff; this.invalidate() }
    this.rec(pin, eff ?? (p.level ? 255 : 0))
  }

  digitalRead(pin: number) {
    const p = this.pins[pin]
    if (p.mode === 'OUTPUT') return p.pwm != null ? (p.pwm > 127 ? 1 : 0) : p.level
    const v = this.pinVoltage(pin)
    if (v == null) {
      this.warn(`float:${pin}`, `${pin >= 14 ? `A${pin - 14}` : `D${pin}`} 핀이 아무 데도 연결되지 않아 값이 제멋대로 바뀌어요 (플로팅).`)
      return Math.floor(this.now() / 7919) % 3 === 0 ? 1 : 0
    }
    return v >= 2.5 ? 1 : 0
  }

  analogRead(pin: number) {
    const ap = pin < 14 && pin >= 0 && pin <= 5 ? pin + 14 : pin // analogRead(0) == A0
    if (ap < 14 || ap > 19) {
      this.warn(`ar:${pin}`, `analogRead 는 A0~A5 핀에서만 쓸 수 있어요.`)
      return 0
    }
    const v = this.pinVoltage(ap)
    if (v == null) {
      this.warn(`float:${ap}`, `A${ap - 14} 핀이 아무 데도 연결되지 않아 값이 제멋대로예요 (플로팅).`)
      return 300 + (Math.floor(this.now() / 5003) % 200)
    }
    return Math.max(0, Math.min(1023, Math.round((v / 5) * 1023)))
  }

  pulseIn(pin: number, level: number, timeoutUs: number) {
    const fail = { value: 0, waitedUs: timeoutUs }
    const node = pinNumberToNode(pin)
    if (!node) return fail
    const r = this.solve()
    const echoNet = r.net.find(node)
    for (const part of this.circuit.parts) {
      if (part.kind !== 'ultrasonic') continue
      if (r.net.net(part.id, 'echo') !== echoNet) continue
      if (!r.modules.get(part.id)?.powered) return fail
      const trigNet = r.net.net(part.id, 'trig')
      const now = this.now()
      let triggered = false
      this.pins.forEach((p, i) => {
        const n = pinNumberToNode(i)
        if (!n || p.mode !== 'OUTPUT' || r.net.find(n) !== trigNet) return
        const q = this.pulse.get(i)
        if (q && q.fall !== Infinity && q.fall - q.rise >= 8 && now - q.fall < 2000) triggered = true
      })
      if (!triggered) {
        this.warn('trig', '초음파 센서에 Trig 신호(HIGH 10µs)가 들어가지 않았어요.')
        return fail
      }
      if (level !== 1) return fail
      const dist = this.values['ultrasonic.distance'] ?? 100
      const duration = Math.round(dist / 0.017)
      if (duration > timeoutUs) return fail
      return { value: duration, waitedUs: 450 + duration }
    }
    return fail
  }

  dhtRead(pin: number) {
    const node = pinNumberToNode(pin)
    const fail = { ok: false, temperature: 0, humidity: 0 }
    if (!node) return fail
    const r = this.solve()
    for (const part of this.circuit.parts) {
      if (part.kind !== 'dht11') continue
      if (r.net.net(part.id, 'data') !== r.net.find(node)) continue
      if (!r.modules.get(part.id)?.powered) return fail
      const last = this.dhtLast.get(pin)
      const now = this.now()
      if (last != null && now - last < 1000_000) this.warn('dhtfast', 'DHT11 을 1초보다 자주 읽고 있어요. 측정 주기는 1~2초 이상이 좋아요.')
      this.dhtLast.set(pin, now)
      return { ok: true, temperature: Math.round(this.values['dht11.temperature'] ?? 24), humidity: Math.round(this.values['dht11.humidity'] ?? 50) }
    }
    return fail
  }

  serialBegin() { this.serialStarted = true }
  serialWrite(text: string) {
    if (!this.serialStarted) {
      this.warn('serial', 'Serial.begin(9600) 을 setup 에서 먼저 호출해야 시리얼 모니터에 글자가 나와요.')
      return
    }
    this.serialOut.push({ t: this.now(), text })
    if (this.serialOut.length > 5000) this.serialOut.splice(0, 1000)
    this.onSerial?.(text)
  }
  serialAvailable() { return this.serialIn.length }
  serialRead() { return this.serialIn.length ? this.serialIn.shift()! : -1 }
  sendSerial(text: string) { for (const ch of text + '\n') this.serialIn.push(ch.charCodeAt(0)) }

  warn(key: string, msg: string) { if (!this.warnings.has(key)) this.warnings.set(key, msg) }

  // ── 화면 표시용 ──
  snapshot(): BoardSnapshot {
    const r = this.solve()
    const leds: BoardSnapshot['leds'] = {}
    for (const part of this.circuit.parts) {
      if (!isLed(part.kind)) continue
      const l = r.leds.get(part.id)!
      let b = l.on ? Math.min(1, 0.25 + l.current / 0.012) : 0
      if (l.on) b *= this.ledDuty(r, part.id)
      leds[part.id] = { brightness: b, burnt: this.burnt.has(part.id), reversed: l.reversed }
    }
    const modules: BoardSnapshot['modules'] = {}
    for (const [id, m] of r.modules) modules[id] = { powered: m.powered, reversed: m.reversed }
    const p13 = this.pins[13]
    const builtin = p13.mode === 'OUTPUT' ? (p13.pwm != null ? p13.pwm / 255 : p13.level) : 0
    return { leds, builtin, modules, warnings: [...this.warnings.values()], pins: this.pins.map((p) => ({ ...p })) }
  }

  /** LED 를 구동하는 PWM 핀의 듀티 (저항 하나 거친 곳까지 찾음) */
  private ledDuty(r: SolveResult, ledId: string) {
    const nets = new Set([r.net.net(ledId, 'anode')!])
    for (const part of this.circuit.parts) {
      if (!isResistor(part.kind)) continue
      const a = r.net.net(part.id, 'r1')!
      const b = r.net.net(part.id, 'r2')!
      if (nets.has(a)) nets.add(b)
      else if (nets.has(b)) nets.add(a)
    }
    let duty = 1
    this.pins.forEach((p, i) => {
      const n = pinNumberToNode(i)
      if (n && p.mode === 'OUTPUT' && p.pwm != null && nets.has(r.net.find(n))) duty = p.pwm / 255
    })
    return duty
  }
}

/** 센서 기본값 */
export function defaultValues(): Record<string, number> {
  const v: Record<string, number> = {}
  for (const s of Object.values(SENSOR_MAP)) for (const c of s.controls) v[`${s.id}.${c.key}`] = c.default
  return v
}
