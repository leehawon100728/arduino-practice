import type { Circuit, Netlist, PlacedPart } from './parts'
import { PART_DEFS, isLed, isResistor } from './parts'
import { pinNumberToNode } from './geometry'

// ─────────────────────────────────────────────────────────────
// 아주 단순한 회로 해석기 (절점 해석, 노턴 등가)
// - 전원/핀 출력: 전압원 + 내부저항
// - 저항, CDS: 컨덕턴스
// - LED: 순방향 전압 Vf 를 넘으면 (Vf 전압원 + 10Ω) 으로 켜짐, 아니면 끊김
// - 센서 모듈: VCC-GND 에 4V 이상 걸리면 동작, 출력핀은 100Ω 출력
// ─────────────────────────────────────────────────────────────

export type PinMode = 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP'

export interface PinState {
  mode: PinMode
  /** 디지털 레벨 (OUTPUT 일 때) */
  level: 0 | 1
  /** analogWrite 값 0~255. digitalWrite 면 null */
  pwm: number | null
}

export interface SolveInput {
  circuit: Circuit
  net: Netlist
  pins: PinState[]
  values: Record<string, number>
  irActiveLow: boolean
  burnt: Set<string>
}

export interface LedResult { on: boolean; current: number; reversed: boolean }
export interface ModuleResult { powered: boolean; reversed: boolean; vcc: number }

export interface SolveResult {
  short: boolean
  v: Map<string, number>
  floating: Set<string>
  leds: Map<string, LedResult>
  modules: Map<string, ModuleResult>
  /** 출력 핀별 전류 (A, 양수 = 핀에서 나감) */
  pinCurrent: Map<number, number>
  net: Netlist
}

const PIN_R = 25
const LED_R = 10
const LEAK = 1e-9
const LED_VF: Record<string, number> = { 'led-red': 1.9, 'led-green': 2.2, 'led-blue': 3.0 }

/** 밝기(%) → CDS 저항. 밝을수록 작음 (0% ≈ 200kΩ, 100% ≈ 1kΩ) */
export function cdsOhms(light: number) {
  const t = Math.max(0, Math.min(100, light)) / 100
  return 200000 * Math.pow(1000 / 200000, t)
}

export const LINE_ANALOG = { white: 100, black: 900 }

interface G { a: string; b: string; g: number; strong: boolean }
interface Src { a: string; v: number; g: number }

export function solveCircuit(inp: SolveInput): SolveResult {
  const { net, circuit, pins, values } = inp
  const gnd = net.find('GND')
  const short = net.same('5V', 'GND')

  const gs: G[] = []
  const srcs: Src[] = []
  const addG = (a: string, b: string, g: number) => gs.push({ a: net.find(a), b: net.find(b), g, strong: g > 1e-7 })
  const addSrc = (a: string, v: number, g: number) => srcs.push({ a: net.find(a), v, g })

  if (!short) addSrc('5V', 5, 1000)
  addSrc('3V3', 3.3, 1000)

  pins.forEach((p, i) => {
    const node = pinNumberToNode(i)
    if (!node) return
    if (p.mode === 'OUTPUT') {
      const high = p.pwm != null ? p.pwm > 0 : p.level === 1
      addSrc(node, high ? 5 : 0, 1 / PIN_R)
    } else if (p.mode === 'INPUT_PULLUP') {
      addSrc(node, 5, 1 / 35000)
    }
  })

  const leds: PlacedPart[] = []
  const modules: PlacedPart[] = []
  for (const part of circuit.parts) {
    const def = PART_DEFS[part.kind]
    const n = (leg: string) => net.net(part.id, leg)!
    if (isResistor(part.kind)) addG(n('r1'), n('r2'), 1 / def.ohms!)
    else if (isLed(part.kind)) leds.push(part)
    else if (def.module) modules.push(part)
  }

  // ── 1차: 모듈 출력 없이 풀어서 전원 상태 확인 ──
  const ledOn = new Map<string, boolean>(leds.map((l) => [l.id, false]))
  const ledStamps = () => {
    const extraG: G[] = []
    const extraS: { a: string; i: number }[] = []
    for (const l of leds) {
      const a = net.net(l.id, 'anode')!
      const k = net.net(l.id, 'cathode')!
      if (ledOn.get(l.id) && !inp.burnt.has(l.id)) {
        const g = 1 / LED_R
        const vf = LED_VF[l.kind]
        extraG.push({ a, b: k, g, strong: true })
        extraS.push({ a, i: vf * g }, { a: k, i: -vf * g })
      }
    }
    return { extraG, extraS }
  }

  let mod = new Map<string, ModuleResult>()
  let result = linearSolve(gnd, gs, srcs, [], [])
  const modOut = (): { g: G[]; s: Src[] } => {
    const g: G[] = []
    const s: Src[] = []
    for (const m of modules) {
      const st = mod.get(m.id)
      if (!st?.powered) continue
      const vcc = st.vcc
      const n = (leg: string) => net.net(m.id, leg)!
      const lvl = (high: boolean) => (high ? vcc : 0)
      switch (m.kind) {
        case 'pir': s.push({ a: n('out'), v: lvl((values['pir.motion'] ?? 0) === 1), g: 1 / 100 }); break
        case 'ir': {
          const obstacle = (values['ir.obstacle'] ?? 0) === 1
          s.push({ a: n('out'), v: lvl(inp.irActiveLow ? !obstacle : obstacle), g: 1 / 100 })
          break
        }
        case 'line': {
          const white = (values['line.white'] ?? 0) === 1
          s.push({ a: n('d0'), v: lvl(!white), g: 1 / 100 })
          s.push({ a: n('a0'), v: ((white ? LINE_ANALOG.white : LINE_ANALOG.black) / 1023) * vcc, g: 1 / 1000 })
          break
        }
        case 'dht11': s.push({ a: n('data'), v: vcc, g: 1 / 10000 }); break
        case 'ultrasonic': s.push({ a: n('echo'), v: 0, g: 1 / 100 }); break
        case 'cds': {
          // 모듈 내부에 분배 저항(10kΩ)이 들어 있다고 가정: 어두울수록(저항 큼) AO 전압이 커진다
          const rc = cdsOhms(values['cds.light'] ?? 60)
          s.push({ a: n('ao'), v: (vcc * rc) / (10000 + rc), g: 1 / 1000 })
          break
        }
      }
    }
    return { g, s }
  }
  const computeModules = () => {
    const m = new Map<string, ModuleResult>()
    for (const part of modules) {
      const vv = result.v.get(net.net(part.id, 'vcc')!) ?? 0
      const vg = result.v.get(net.net(part.id, 'gnd')!) ?? 0
      m.set(part.id, { powered: vv - vg > 4, reversed: vg - vv > 4, vcc: vv })
    }
    return m
  }

  // 반복: LED 상태와 모듈 전원이 안정될 때까지
  for (let iter = 0; iter < 10; iter++) {
    const { extraG, extraS } = ledStamps()
    const mo = modOut()
    result = linearSolve(gnd, [...gs, ...extraG, ...mo.g], [...srcs, ...mo.s], extraS, leds.map((l) => net.net(l.id, 'anode')!))
    const newMod = computeModules()
    let changed = false
    for (const [id, st] of newMod) if (mod.get(id)?.powered !== st.powered) changed = true
    mod = newMod
    for (const l of leds) {
      if (inp.burnt.has(l.id)) continue
      const va = result.v.get(net.net(l.id, 'anode')!) ?? 0
      const vk = result.v.get(net.net(l.id, 'cathode')!) ?? 0
      const on = ledOn.get(l.id)!
      const vf = LED_VF[l.kind]
      const next = on ? (va - vk - vf) / LED_R > 1e-5 : va - vk > vf + 0.01
      if (next !== on) { ledOn.set(l.id, next); changed = true }
    }
    if (!changed) break
  }

  const ledRes = new Map<string, LedResult>()
  for (const l of leds) {
    const va = result.v.get(net.net(l.id, 'anode')!) ?? 0
    const vk = result.v.get(net.net(l.id, 'cathode')!) ?? 0
    const on = !!ledOn.get(l.id) && !inp.burnt.has(l.id)
    const current = on ? (va - vk - LED_VF[l.kind]) / LED_R : 0
    ledRes.set(l.id, { on: on && current > 1e-5, current: Math.max(0, current), reversed: vk - va > 1.5 })
  }

  const pinCurrent = new Map<number, number>()
  pins.forEach((p, i) => {
    const node = pinNumberToNode(i)
    if (!node || p.mode !== 'OUTPUT') return
    const high = p.pwm != null ? p.pwm > 0 : p.level === 1
    const vn = result.v.get(net.find(node)) ?? 0
    pinCurrent.set(i, ((high ? 5 : 0) - vn) / PIN_R)
  })

  return { short, v: result.v, floating: result.floating, leds: ledRes, modules: mod, pinCurrent, net }
}

/** 노턴 등가로 G·V = I 를 가우스 소거법으로 푼다. gnd 는 0V 기준. */
function linearSolve(gnd: string, gs: G[], srcs: Src[], currents: { a: string; i: number }[], extraNodes: string[]) {
  const idx = new Map<string, number>()
  const id = (n: string) => {
    if (n === gnd) return -1
    let i = idx.get(n)
    if (i === undefined) { i = idx.size; idx.set(n, i) }
    return i
  }
  for (const g of gs) { id(g.a); id(g.b) }
  for (const s of srcs) id(s.a)
  for (const c of currents) id(c.a)
  for (const n of extraNodes) id(n)
  const N = idx.size
  const A: number[][] = Array.from({ length: N }, () => new Array(N).fill(0))
  const b = new Array(N).fill(0)
  for (let i = 0; i < N; i++) A[i][i] += LEAK
  for (const g of gs) {
    const i = id(g.a)
    const j = id(g.b)
    if (i >= 0) A[i][i] += g.g
    if (j >= 0) A[j][j] += g.g
    if (i >= 0 && j >= 0) { A[i][j] -= g.g; A[j][i] -= g.g }
  }
  for (const s of srcs) {
    const i = id(s.a)
    if (i < 0) continue
    A[i][i] += s.g
    b[i] += s.g * s.v
  }
  for (const c of currents) {
    const i = id(c.a)
    if (i >= 0) b[i] += c.i
  }
  // 가우스 소거 (부분 피벗)
  for (let c = 0; c < N; c++) {
    let p = c
    for (let r = c + 1; r < N; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (p !== c) { [A[p], A[c]] = [A[c], A[p]]; [b[p], b[c]] = [b[c], b[p]] }
    const piv = A[c][c] || 1e-12
    for (let r = c + 1; r < N; r++) {
      const f = A[r][c] / piv
      if (f === 0) continue
      for (let k = c; k < N; k++) A[r][k] -= f * A[c][k]
      b[r] -= f * b[c]
    }
  }
  const x = new Array(N).fill(0)
  for (let r = N - 1; r >= 0; r--) {
    let s = b[r]
    for (let k = r + 1; k < N; k++) s -= A[r][k] * x[k]
    x[r] = s / (A[r][r] || 1e-12)
  }
  const v = new Map<string, number>()
  v.set(gnd, 0)
  for (const [n, i] of idx) v.set(n, x[i])

  // 플로팅: 전원(소스, GND)에 강한 연결로 닿지 않는 넷
  const adj = new Map<string, string[]>()
  const link = (a: string, c: string) => { (adj.get(a) ?? adj.set(a, []).get(a)!).push(c) }
  for (const g of gs) if (g.strong) { link(g.a, g.b); link(g.b, g.a) }
  const seen = new Set<string>([gnd, ...srcs.map((s) => s.a)])
  const stack = [...seen]
  while (stack.length) {
    const n = stack.pop()!
    for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); stack.push(m) }
  }
  const floating = new Set<string>()
  for (const n of idx.keys()) if (!seen.has(n)) floating.add(n)
  return { v, floating }
}
