import type { AppliedCard, CardRule, Problem, SensorId } from '../types'
import { getSensor } from '../data/sensors'
import { CARD_MAP } from '../data/cards'
import { compileSource, type CompileResult, type TraceCall } from '../interp/compiler'
import { buildModelCircuit } from '../sim/modelCircuit'
import { Netlist, PART_DEFS, SENSOR_PART, isLed, type Circuit } from '../sim/parts'
import { SimBoard, defaultValues } from '../sim/board'
import { nodeToPinNumber, pinNumberToNode } from '../sim/geometry'
import { Harness, pinNum, sensorStates, serialText, type WindowResult } from './harness'
import { josa } from '../lib/josa'
import { cardTitle } from '../lib/solution'

// ─────────────────────────────────────────────────────────────
// 채점: 배선 40 + 코드 30 + 동작 30 = 100
// 정해진 임계값과 같은지는 보지 않고, "두 센서가 LED 에 영향을 주는가" 를 본다.
// ─────────────────────────────────────────────────────────────

export type Section = 'wiring' | 'code' | 'behavior'

export interface CheckItem {
  id: string
  section: Section
  label: string
  ok: boolean
  weight: number
  message?: string
  /** 감점 없는 참고 사항 */
  note?: string
}

export interface GradeReport {
  score: number
  raw: number
  hintPenalty: number
  sections: Record<Section, { score: number; max: number }>
  items: CheckItem[]
  compileErrors: { line: number; message: string }[]
  warnings: string[]
  readLines: number[]
  writeLines: number[]
  serialSample: string
  failedIds: string[]
}

const MAX: Record<Section, number> = { wiring: 40, code: 30, behavior: 30 }

const sensorName = (id: SensorId) => getSensor(id).name
const pinLabel = (n: number) => (n >= 14 ? `A${n - 14}` : `D${n}`)

export interface GradeInput {
  problem: Problem
  code: string
  circuit: Circuit
  hintsUsed?: number
}

export function grade(inp: GradeInput): GradeReport {
  const { problem, code, circuit } = inp
  const items: CheckItem[] = []
  const add = (it: CheckItem) => items.push(it)
  const compiled = compileSource(code)
  const warnings = compiled.warnings.map((w) => `${w.line}번째 줄: ${w.message}`)

  // ── 실행해서 흔적(trace) 모으기 + 동작 검사 ──
  let beh: BehaviorResult | null = null
  if (compiled.ok) beh = runBehavior(compiled, problem)

  // ── 1) 배선 ──
  gradeWiring(problem, circuit, beh, add)

  // ── 2) 코드 ──
  add({
    id: 'code.compile', section: 'code', label: '문법 오류 없음', weight: 8, ok: compiled.ok,
    message: compiled.ok ? undefined : compiled.errors.map((e) => `${e.line}번째 줄: ${e.message}`).join('\n'),
  })
  if (beh) gradeCode(problem, compiled, beh, add)
  else {
    for (const id of problem.sensors) add({ id: `code.read.${id}`, section: 'code', label: `${sensorName(id)} 값 읽기`, weight: 5, ok: false, message: '문법 오류를 먼저 고쳐야 검사할 수 있어요.' })
    add({ id: 'code.pinmode', section: 'code', label: 'pinMode 설정', weight: 5, ok: false, message: '문법 오류를 먼저 고쳐야 검사할 수 있어요.' })
    add({ id: 'code.led', section: 'code', label: 'LED 출력 코드', weight: 4, ok: false, message: '문법 오류를 먼저 고쳐야 검사할 수 있어요.' })
  }

  // ── 3) 동작 ──
  if (beh) gradeBehavior(problem, compiled, beh, code, add)
  else add({ id: 'beh.run', section: 'behavior', label: '프로그램 실행', weight: 30, ok: false, message: '문법 오류 때문에 실행할 수 없어요.' })

  // ── 점수 ──
  const sections = {} as GradeReport['sections']
  let raw = 0
  for (const sec of ['wiring', 'code', 'behavior'] as Section[]) {
    const list = items.filter((i) => i.section === sec)
    const total = list.reduce((s, i) => s + i.weight, 0) || 1
    const got = list.filter((i) => i.ok).reduce((s, i) => s + i.weight, 0)
    const score = Math.round((got / total) * MAX[sec] * 10) / 10
    sections[sec] = { score, max: MAX[sec] }
    raw += score
  }
  raw = Math.round(raw)
  const hintPenalty = (inp.hintsUsed ?? 0) * problem.hintPenalty
  const calls = beh ? [...beh.trace.values()] : []
  return {
    score: Math.max(0, raw - hintPenalty),
    raw,
    hintPenalty,
    sections,
    items,
    compileErrors: compiled.errors,
    warnings: [...warnings, ...(beh?.warnings ?? [])],
    readLines: [...new Set(calls.filter((c) => ['digitalRead', 'analogRead', 'pulseIn', 'dht'].includes(c.name)).map((c) => c.line))].sort((a, b) => a - b),
    writeLines: [...new Set(calls.filter((c) => (c.name === 'digitalWrite' || c.name === 'analogWrite') && c.pin != null && problem.leds.some((l) => pinNum(l.pin) === c.pin)).map((c) => c.line))].sort((a, b) => a - b),
    serialSample: beh ? beh.serialSample : '',
    failedIds: items.filter((i) => !i.ok).map((i) => i.id),
  }
}

// ─────────────────────────────────────────────────────────────
// 동작 실행
// ─────────────────────────────────────────────────────────────

interface BehaviorResult {
  grid: WindowResult[][]
  statesA: Record<string, number>[]
  statesB: Record<string, number>[]
  trace: Map<string, TraceCall>
  pinModes: Map<number, string>
  error: string | null
  warnings: string[]
  serialSample: string
  modelCircuit: Circuit
  buttonPullup: boolean
}

function timing(problem: Problem) {
  const dht = problem.sensors.includes('dht11')
  const periodic = problem.cards.some((c) => c.cardId === 'every-5s')
  return {
    settle: dht ? 2700 : 900,
    measure: periodic ? 5600 : dht ? 5300 : 2200,
  }
}

function detectButtonPullup(compiled: CompileResult, problem: Problem) {
  if (!problem.sensors.includes('button')) return false
  // 미리 짧게 실행해서 버튼 핀의 pinMode 를 본다
  const circuit = buildModelCircuit({ ...problem, buttonMode: 'pulldown' })
  const h = new Harness(compiled, circuit, problem)
  h.run(50, 20000)
  const pin = pinNum(problem.pins.button!.sig)
  return h.runner.ctx.trace.pinModes.get(pin) === 'INPUT_PULLUP'
}

function runBehavior(compiled: CompileResult, problem: Problem): BehaviorResult {
  const pullup = detectButtonPullup(compiled, problem)
  const modelCircuit = buildModelCircuit({ ...problem, buttonMode: pullup ? 'pullup' : 'pulldown' })
  const h = new Harness(compiled, modelCircuit, problem)
  const [A, B] = problem.sensors
  const statesA = sensorStates(A)
  const statesB = B ? sensorStates(B) : [{}]
  const { settle, measure } = timing(problem)
  h.run(settle) // 기본값에서 setup 실행 (캘리브레이션은 이 값을 읽는다)
  const grid: WindowResult[][] = []
  let error: string | null = null
  outer: for (const sb of statesB) {
    // B 를 고정하고 A 를 훑는다 (grid[i][j] = A 상태 i, B 상태 j)
    for (let i = 0; i < statesA.length; i++) {
      const w = h.window({ ...sb, ...statesA[i] }, settle, measure)
      ;(grid[i] ??= []).push(w)
      if (w.error) { error = w.error; break outer }
    }
  }
  const sample = serialText(h.board.serialOut).split(/\r?\n/).filter(Boolean).slice(0, 12).join('\n')
  return {
    grid, statesA, statesB, trace: h.runner.ctx.trace.calls, pinModes: h.runner.ctx.trace.pinModes, error,
    warnings: [...h.board.warnings.values()], serialSample: sample, modelCircuit, buttonPullup: pullup,
  }
}

// ─────────────────────────────────────────────────────────────
// 1) 배선 검사
// ─────────────────────────────────────────────────────────────

type Add = (it: CheckItem) => void

function gradeWiring(problem: Problem, circuit: Circuit, beh: BehaviorResult | null, add: Add) {
  const net = new Netlist(circuit)
  const board = new SimBoard(circuit, defaultValues(), { irActiveLow: problem.irActiveLow })
  const solve = board.solve()

  add({ id: 'wire.short', section: 'wiring', label: '5V-GND 단락 없음', weight: 3, ok: !solve.short, message: solve.short ? '5V 와 GND 가 바로 연결됐어요 (단락). 레일 연결을 확인하세요.' : undefined })

  const usesD01 = circuit.wires.some((w) => ['P:D0', 'P:D1'].includes(w.a) || ['P:D0', 'P:D1'].includes(w.b))
  add({ id: 'wire.d01', section: 'wiring', label: 'D0/D1 핀 사용 안 함', weight: 2, ok: !usesD01, message: usesD01 ? 'D0, D1 은 시리얼 통신(USB)용 핀이라 쓰면 안 돼요.' : undefined })

  /** 넷에 연결된 아두이노 핀 번호들 */
  const pinsOnNet = (n: string | null) => {
    if (!n) return []
    const out: number[] = []
    for (let p = 0; p <= 19; p++) if (net.find(pinNumberToNode(p)!) === n) out.push(p)
    return out
  }

  const signalNets: { label: string; net: string; pin: number }[] = []
  const wiredPin: Record<string, number | null> = {}

  for (const id of problem.sensors) {
    const s = getSensor(id)
    const kind = SENSOR_PART[id]
    const parts = circuit.parts.filter((p) => p.kind === kind)
    const name = sensorName(id)
    if (!parts.length) {
      add({ id: `wire.${id}.placed`, section: 'wiring', label: `${name} 배치`, weight: 12, ok: false, message: `${josa(name, '이가')} 브레드보드에 없어요. 왼쪽 부품 트레이에서 끌어다 꽂으세요.` })
      continue
    }
    const pins = problem.pins[id]!

    if (PART_DEFS[kind].module) {
      // 모듈: 여러 개면 가장 잘 연결된 것을 고른다
      const part = parts
        .map((p) => ({ p, score: (net.same(net.net(p.id, 'vcc')!, '5V') ? 1 : 0) + (net.same(net.net(p.id, 'gnd')!, 'GND') ? 1 : 0) }))
        .sort((a, b) => b.score - a.score)[0].p
      const vcc = net.net(part.id, 'vcc')!
      const gnd = net.net(part.id, 'gnd')!
      const mod = solve.modules.get(part.id)
      let pmsg: string | undefined
      if (mod?.reversed) pmsg = `${name} 의 VCC 와 GND 가 반대로 연결됐어요.`
      else if (!net.same(vcc, '5V')) pmsg = net.same(vcc, '3V3') ? `${name} VCC 가 3.3V 에 연결됐어요. 5V 에 연결하세요.` : `${name} VCC 가 5V 에 연결되지 않았어요.`
      else if (!net.same(gnd, 'GND')) pmsg = `${name} GND 가 GND 에 연결되지 않았어요.`
      add({ id: `wire.${id}.power`, section: 'wiring', label: `${name} 전원 (VCC→5V, GND→GND)`, weight: 6, ok: !pmsg, message: pmsg })

      // 라인센서는 D0 또는 A0 중 하나만 연결해도 된다
      const anyOf = id === 'line'
      const required = anyOf ? s.signals : s.signals.filter((g) => g.required)
      const lineMsgs: string[] = []
      let lineOk = false
      for (const sig of required) {
        const n = net.net(part.id, sig.modulePin!)!
        const expected = pinNum(pins[sig.key])
        const on = pinsOnNet(n)
        wiredPin[`${id}.${sig.key}`] = on[0] ?? null
        let msg: string | undefined
        if (net.same(n, '5V') || net.same(n, 'GND')) msg = `${name} ${sig.label} 가 전원(5V/GND)에 연결됐어요. 아두이노 ${pinLabel(expected)} 에 연결하세요.`
        else if (!on.length) msg = `${name} ${josa(sig.label, '이가')} 어느 핀에도 연결되지 않았어요. ${pinLabel(expected)} 에 연결하세요.`
        else if (!on.includes(expected)) msg = `${name} ${sig.label} 는 ${pinLabel(expected)} 에 연결해야 하는데 ${on.map(pinLabel).join(', ')} 에 연결됐어요.`
        else signalNets.push({ label: `${name} ${sig.label}`, net: n, pin: expected })
        if (anyOf) {
          if (!msg) lineOk = true
          else if (on.length || sig.required) lineMsgs.push(msg)
          if (!on.includes(expected)) wiredPin[`${id}.${sig.key}`] = null
          continue
        }
        add({ id: `wire.${id}.${sig.key}`, section: 'wiring', label: `${name} ${sig.label} → ${pinLabel(expected)}`, weight: 6 / required.length, ok: !msg, message: msg })
      }
      if (anyOf) {
        add({ id: `wire.${id}.signal`, section: 'wiring', label: `${name} D0 → ${pinLabel(pinNum(pins.d0))} 또는 A0 → ${pinLabel(pinNum(pins.a0))}`, weight: 6, ok: lineOk, message: lineOk ? undefined : lineMsgs.join('\n') })
      }
      continue
    }

    if (id === 'button') {
      const expected = pinNum(pins.sig)
      const pullup = beh?.buttonPullup ?? problem.buttonMode === 'pullup'
      const read = (pressed: boolean) => {
        const b = new SimBoard(circuit, { ...defaultValues(), 'button.pressed': pressed ? 1 : 0 })
        b.pinMode(expected, pullup ? 'INPUT_PULLUP' : 'INPUT')
        b.warnings.clear()
        const v = b.digitalRead(expected)
        return { v, floating: [...b.warnings.keys()].some((k) => k.startsWith('float')), short: b.solve().short }
      }
      const up = read(false)
      const down = read(true)
      const touches = parts.some((p) => ['a1', 'b1'].some((leg) => pinsOnNet(net.net(p.id, leg)).includes(expected)))
      let msg: string | undefined
      if (down.short) msg = '버튼을 누르면 5V 와 GND 가 바로 연결돼요 (단락). 풀다운 저항(10kΩ)을 신호 핀과 GND 사이에 넣으세요.'
      else if (!touches) msg = `버튼이 ${pinLabel(expected)} 핀에 연결되지 않았어요.`
      else if (up.floating) msg = pullup ? '버튼 반대쪽 다리를 GND 에 연결하세요.' : '버튼을 떼면 신호 핀이 떠 있어요(플로팅). 신호 핀과 GND 사이에 10kΩ 풀다운 저항을 넣거나 INPUT_PULLUP 을 쓰세요.'
      else if (up.v === down.v) msg = '버튼을 눌러도 신호가 바뀌지 않아요. 버튼이 중앙 홈을 가로질러 꽂혔는지, 반대쪽 다리가 5V(풀다운) 또는 GND(풀업)에 연결됐는지 확인하세요.'
      wiredPin['button.sig'] = touches ? expected : null
      if (!msg) signalNets.push({ label: '버튼 신호', net: net.find(pinNumberToNode(expected)!), pin: expected })
      add({ id: 'wire.button.circuit', section: 'wiring', label: `버튼 회로 (${pullup ? '내부 풀업' : '풀다운 10kΩ'}) → ${pinLabel(expected)}`, weight: 12, ok: !msg, message: msg })
      continue
    }

    if (id === 'cds') {
      const expected = pinNum(pins.a0)
      const read = (light: number) => {
        const b = new SimBoard(circuit, { ...defaultValues(), 'cds.light': light })
        b.warnings.clear()
        const v = b.analogRead(expected)
        return { v, floating: [...b.warnings.keys()].some((k) => k.startsWith('float')) }
      }
      const dark = read(0)
      const bright = read(100)
      const touches = parts.some((p) => ['l1', 'l2'].some((leg) => pinsOnNet(net.net(p.id, leg)).includes(expected)))
      let msg: string | undefined
      let note: string | undefined
      if (!touches) msg = `CDS 가 ${pinLabel(expected)} 에 연결되지 않았어요. CDS 와 10kΩ 이 만나는 줄을 ${pinLabel(expected)} 에 연결하세요.`
      else if (dark.floating) msg = 'CDS 회로가 5V 나 GND 에 연결되지 않았어요.'
      else if (Math.abs(dark.v - bright.v) < 200) msg = 'CDS 값이 밝기에 따라 거의 변하지 않아요. 5V ─ 10kΩ ─ A0 ─ CDS ─ GND 전압 분배 회로를 만들어야 해요.'
      else if (bright.v > dark.v) note = '이 배선은 밝을수록 값이 커져요 (수업 슬라이드와 반대). 조건식을 그에 맞게 쓰면 괜찮아요.'
      wiredPin['cds.a0'] = touches ? expected : null
      if (!msg) signalNets.push({ label: 'CDS 분배점', net: net.find(pinNumberToNode(expected)!), pin: expected })
      add({ id: 'wire.cds.circuit', section: 'wiring', label: `CDS 전압 분배 회로 → ${pinLabel(expected)}`, weight: 12, ok: !msg, message: msg, note })
    }
  }

  // ── LED ──
  const ledParts = circuit.parts.filter((p) => isLed(p.kind))
  problem.leds.forEach((l, i) => {
    const pin = pinNum(l.pin)
    const name = `LED${problem.leds.length > 1 ? i + 1 : ''}`
    const label = `${name} → ${pinLabel(pin)} (긴 다리+, 220Ω, GND)`
    if (ledParts.length <= i && ledParts.length < problem.leds.length && i >= ledParts.length) {
      add({ id: `wire.led${i + 1}`, section: 'wiring', label, weight: 8, ok: false, message: `LED 가 ${problem.leds.length}개 필요한데 ${ledParts.length}개만 있어요.` })
      return
    }
    const test = (level: 0 | 1) => {
      const b = new SimBoard(circuit, defaultValues())
      b.pinMode(pin, 'OUTPUT')
      b.digitalWrite(pin, level)
      return { snap: b.snapshot(), solve: b.solve(), warnings: [...b.warnings.keys()] }
    }
    const hi = test(1)
    const lo = test(0)
    const lit = ledParts.filter((p) => (hi.solve.leds.get(p.id)?.on || hi.snap.leds[p.id]?.burnt) && !lo.solve.leds.get(p.id)?.on)
    let msg: string | undefined
    if (lit.length) {
      const p = lit[0]
      const res = hi.solve.leds.get(p.id)!
      if (hi.snap.leds[p.id]?.burnt || res.current > 0.03) msg = `${name} 에 저항이 없어요. 전류가 너무 많이 흘러 LED 가 터져요. 220Ω 을 직렬로 연결하세요.`
      else if (res.current < 0.001) msg = `${name} 이 너무 어두워요. 220Ω 저항을 쓰세요 (10kΩ 은 너무 커요).`
    } else {
      const always = ledParts.find((p) => lo.solve.leds.get(p.id)?.on)
      const reversed = ledParts.find((p) => {
        const b = new SimBoard(circuit, defaultValues())
        b.pinMode(pin, 'OUTPUT'); b.digitalWrite(pin, 1)
        return b.solve().leds.get(p.id)?.reversed
      })
      if (reversed) msg = `${name} 극성이 반대예요. 긴 다리(+)가 핀(저항) 쪽, 짧은 다리(−)가 GND 쪽이어야 해요.`
      else if (always) msg = `${name} 이 ${pinLabel(pin)} 가 아니라 5V 에 연결돼서 항상 켜져 있어요.`
      else {
        // 어느 쪽이 끊겼는지 찾기
        const candidates = ledParts.map((p) => ({ p, a: net.net(p.id, 'anode')!, k: net.net(p.id, 'cathode')! }))
        const cathodeOk = candidates.some((c) => net.same(c.k, 'GND'))
        msg = cathodeOk
          ? `${name} 가 ${pinLabel(pin)} 핀에 연결되지 않았어요. ${pinLabel(pin)} → 220Ω → LED 긴 다리(+) 순서로 연결하세요.`
          : `${name} 짧은 다리(−)가 GND 에 연결되지 않았어요.`
      }
    }
    if (!msg) signalNets.push({ label: name, net: net.find(pinNumberToNode(pin)!), pin })
    wiredPin[`led${i}`] = lit.length ? pin : null
    add({ id: `wire.led${i + 1}`, section: 'wiring', label, weight: 8, ok: !msg, message: msg })
  })

  // ── 핀 충돌 ──
  const conflicts: string[] = []
  for (let a = 0; a < signalNets.length; a++)
    for (let b = a + 1; b < signalNets.length; b++)
      if (signalNets[a].net === signalNets[b].net) conflicts.push(`${signalNets[a].label} 와 ${signalNets[b].label} 가 같은 줄(${pinLabel(signalNets[a].pin)})에 연결됐어요.`)
  add({ id: 'wire.conflict', section: 'wiring', label: '핀 충돌 없음', weight: 3, ok: conflicts.length === 0, message: conflicts.join('\n') || undefined })

  // ── 코드 핀 = 배선 핀 ──
  if (beh) {
    const mism: string[] = []
    const used = codePins(beh.trace)
    for (const id of problem.sensors) {
      const sigs = id === 'line' ? getSensor(id).signals : getSensor(id).signals.filter((g) => g.required)
      const lineUsed = id === 'line' && sigs.some((sig) => { const w = wiredPin[`${id}.${sig.key}`]; return w != null && used.in.has(w) })
      for (const sig of sigs) {
        const w = wiredPin[`${id}.${sig.key}`]
        if (w == null || lineUsed) continue
        if (id === 'line' && !sig.required) continue
        const pool = sig.direction === 'output' ? used.out : used.in
        if (!pool.has(w)) {
          const guess = [...pool].filter((p) => !Object.values(wiredPin).includes(p))
          mism.push(`${sensorName(id)} ${sig.label} 는 ${pinLabel(w)} 에 꽂았는데 코드에서는 ${guess.length ? `${guess.map(pinLabel).join(', ')} 번 핀을 써요` : '그 핀을 쓰지 않아요'}.`)
        }
      }
    }
    problem.leds.forEach((_, i) => {
      const w = wiredPin[`led${i}`]
      if (w != null && !used.out.has(w)) mism.push(`LED${problem.leds.length > 1 ? i + 1 : ''} 는 ${pinLabel(w)} 에 꽂았는데 코드에서 그 핀에 출력하지 않아요.`)
    })
    add({ id: 'wire.codepins', section: 'wiring', label: '코드의 핀 번호 = 배선', weight: 4, ok: mism.length === 0, message: mism.join('\n') || undefined })
  }
}

function codePins(trace: Map<string, TraceCall>) {
  const inp = new Set<number>()
  const out = new Set<number>()
  for (const c of trace.values()) {
    if (c.pin == null) continue
    if (['digitalRead', 'analogRead', 'pulseIn', 'dht'].includes(c.name)) inp.add(c.pin)
    if (['digitalWrite', 'analogWrite'].includes(c.name)) out.add(c.pin)
  }
  return { in: inp, out }
}

// ─────────────────────────────────────────────────────────────
// 2) 코드 검사
// ─────────────────────────────────────────────────────────────

function gradeCode(problem: Problem, compiled: CompileResult, beh: BehaviorResult, add: Add) {
  const calls = [...beh.trace.values()]
  const called = (name: string, pin?: number) => calls.some((c) => c.name === name && (pin === undefined || c.pin === pin))
  const pinsOf = (name: string) => [...new Set(calls.filter((c) => c.name === name && c.pin != null).map((c) => c.pin!))]
  const staticCall = (name: string) => compiled.info.calls.some((c) => c.name === name)

  for (const id of problem.sensors) {
    const pins = problem.pins[id]!
    const name = sensorName(id)
    let ok = false
    let msg: string | undefined
    const wrongPin = (fn: string, expected: number) => {
      const others = pinsOf(fn).filter((p) => p !== expected)
      return others.length ? ` 지금은 ${fn}(${others.map((p) => (p >= 14 ? `A${p - 14}` : p)).join(', ')}) 을(를) 쓰고 있어요.` : ''
    }
    switch (id) {
      case 'ultrasonic': {
        const trig = pinNum(pins.trig)
        const echo = pinNum(pins.echo)
        const pulse = called('pulseIn', echo)
        const trigHigh = called('digitalWrite', trig)
        ok = pulse && trigHigh
        if (!pulse) msg = staticCall('pulseIn') ? `pulseIn(echoPin, HIGH) 이 Echo 핀(${echo})을 읽지 않아요.${wrongPin('pulseIn', echo)}` : 'pulseIn(echoPin, HIGH) 으로 Echo 시간을 재야 해요.'
        else if (!trigHigh) msg = `Trig 핀(${trig})에 digitalWrite 로 HIGH 10µs 신호를 보내야 해요.`
        break
      }
      case 'dht11': {
        const pin = pinNum(pins.data)
        ok = called('dht', pin)
        if (!ok) msg = calls.some((c) => c.name === 'dht') ? `DHT 객체를 ${pin}번 핀으로 만들어야 해요. 예: DHT11 dht11(${pin});` : 'dht11.readTemperatureHumidity(temperature, humidity) 로 온습도를 읽어야 해요.'
        break
      }
      case 'cds': {
        const pin = pinNum(pins.a0)
        ok = called('analogRead', pin)
        if (!ok) msg = called('digitalRead', pin) ? '조도 센서는 digitalRead 가 아니라 analogRead 로 읽어요 (0~1023).' : `analogRead(${pinLabel(pin)}) 로 조도 값을 읽어야 해요.${wrongPin('analogRead', pin)}`
        break
      }
      case 'line': {
        const d0 = pinNum(pins.d0)
        const a0 = pinNum(pins.a0)
        ok = called('digitalRead', d0) || called('analogRead', a0)
        if (!ok) msg = `digitalRead(${d0}) (D0) 또는 analogRead(${pinLabel(a0)}) (A0) 로 라인센서를 읽어야 해요.${wrongPin('digitalRead', d0)}`
        break
      }
      default: {
        const key = getSensor(id).signals[0].key
        const pin = pinNum(pins[key])
        ok = called('digitalRead', pin)
        if (!ok) msg = called('analogRead', pin) ? `${name} 는 디지털 센서라 digitalRead 로 읽어요.` : `digitalRead(${pin}) 로 ${josa(name, '을를')} 읽어야 해요.${wrongPin('digitalRead', pin)}`
      }
    }
    add({ id: `code.read.${id}`, section: 'code', label: `${name} 값 읽기 (${getSensor(id).readMethods.map((m) => (m === 'dht' ? 'DHT 라이브러리' : m)).join(' / ')})`, weight: 5, ok, message: msg })
  }

  // pinMode
  const pm: string[] = []
  for (const id of problem.sensors) {
    for (const sig of getSensor(id).signals) {
      if (!sig.allowedModes.length) continue
      if (!sig.required && !calls.some((c) => c.pin === pinNum(problem.pins[id]![sig.key]))) continue
      const pin = pinNum(problem.pins[id]![sig.key])
      if (id === 'line' && !called('digitalRead', pin)) continue // A0 만 쓰는 경우
      const mode = beh.pinModes.get(pin)
      const label = `${sensorName(id)} ${sig.label}`
      if (!mode) pm.push(`${label} 핀(${pin})의 pinMode(${pin}, ${sig.allowedModes[0]}) 가 없어요.`)
      else if (!sig.allowedModes.includes(mode as 'INPUT')) pm.push(`${label} 핀(${pin})은 ${sig.allowedModes.join(' 또는 ')} 이어야 하는데 ${mode} 로 설정했어요.`)
    }
  }
  problem.leds.forEach((l) => {
    const pin = pinNum(l.pin)
    const mode = beh.pinModes.get(pin)
    if (mode && mode !== 'OUTPUT') pm.push(`LED 핀(${pin})은 OUTPUT 이어야 하는데 ${mode} 로 설정했어요.`)
    else if (!mode && !called('analogWrite', pin)) pm.push(`LED 핀(${pin})의 pinMode(${pin}, OUTPUT) 이 없어요.`)
  })
  add({ id: 'code.pinmode', section: 'code', label: 'pinMode 설정 (센서 INPUT, LED OUTPUT 등)', weight: 5, ok: pm.length === 0, message: pm.join('\n') || undefined })

  // LED 출력
  const ledMsgs: string[] = []
  problem.leds.forEach((l, i) => {
    const pin = pinNum(l.pin)
    if (!called('digitalWrite', pin) && !called('analogWrite', pin)) ledMsgs.push(`LED${problem.leds.length > 1 ? i + 1 : ''} 핀(${pin})에 digitalWrite/analogWrite 가 없어요.`)
  })
  add({ id: 'code.led', section: 'code', label: 'LED 출력 (digitalWrite / analogWrite)', weight: 4, ok: ledMsgs.length === 0, message: ledMsgs.join('\n') || undefined })

  // 시리얼 (Lv2 이상)
  if (problem.requireSerial && problem.sensors.length > 1 && !problem.cards.some((c) => c.cardId === 'serial-both')) {
    const r = checkSerialBoth(problem, beh)
    add({ id: 'code.serial', section: 'code', label: '시리얼 모니터에 두 센서 값 출력', weight: 5, ok: r.ok, message: r.msg })
  }

  // 카드 중 코드 규칙
  for (const c of problem.cards) {
    for (const rule of cardRules(c)) {
      if (rule.kind === 'codeCalls') {
        const ok = calls.some((t) => t.name === rule.fn && (rule.where === 'any' || !rule.where || t.phase === rule.where)) ||
          compiled.info.calls.some((t) => t.name === rule.fn && (rule.where !== 'setup' || t.inFunc === 'setup') && (rule.where !== 'loop' || t.inFunc !== 'setup'))
        add({ id: `card.${c.cardId}.calls.${rule.fn}`, section: 'code', label: `🃏 ${cardTitle(c)}: ${rule.fn}() ${rule.where === 'setup' ? '(setup 에서)' : ''}`, weight: 3, ok, message: ok ? undefined : `${rule.fn}() 를 ${rule.where === 'setup' ? 'setup() 안에서 ' : ''}호출해야 해요.` })
      }
    }
  }
}

function cardRules(c: AppliedCard): CardRule[] {
  const d = CARD_MAP[c.cardId]
  const v = d.variants?.find((x) => x.id === c.variantId)
  return [...d.rules, ...(v?.rules ?? [])]
}

// ─────────────────────────────────────────────────────────────
// 3) 동작 검사
// ─────────────────────────────────────────────────────────────

/** grid[i][j] 에서 LED 시그니처 */
const sigOf = (w: WindowResult) => w.sig.join(',')

function affects(grid: WindowResult[][], axis: 'A' | 'B') {
  const I = grid.length
  const J = grid[0]?.length ?? 0
  if (axis === 'A') {
    for (let j = 0; j < J; j++) {
      const set = new Set<string>()
      for (let i = 0; i < I; i++) if (grid[i][j]) set.add(sigOf(grid[i][j]))
      if (set.size > 1) return true
    }
    return false
  }
  for (let i = 0; i < I; i++) {
    const set = new Set(grid[i].map(sigOf))
    if (set.size > 1) return true
  }
  return false
}

function thresholdHint(code: string, id: SensorId): string {
  // 비교식의 숫자가 센서 범위를 벗어났는지 대략 확인
  const range = getSensor(id).sensibleRange
  if (range.max <= 1) return ''
  const varNames = getSensor(id).snippet.valueVars.map((v) => v.name)
  const found: string[] = []
  const re = /([A-Za-z_]\w*)\s*(<=|>=|<|>|==)\s*(-?\d+(?:\.\d+)?)|(-?\d+(?:\.\d+)?)\s*(<=|>=|<|>|==)\s*([A-Za-z_]\w*)/g
  for (const m of code.matchAll(re)) {
    const name = m[1] ?? m[6]
    const num = Number(m[3] ?? m[4])
    const looksLike = varNames.includes(name) || new RegExp(id === 'ultrasonic' ? 'dist|cm' : id === 'cds' ? 'cds|light|bright|jodo' : 'temp|hum', 'i').test(name)
    if (looksLike && (num < range.min || num > range.max)) found.push(`${name} ${m[2] ?? m[5]} ${num}`)
  }
  return found.length ? ` 조건 '${found[0]}' 의 기준값이 센서 범위(${range.min}~${range.max}${range.unit === '' ? '' : ' ' + range.unit})를 벗어나서 결과가 항상 같아요.` : ''
}

function gradeBehavior(problem: Problem, compiled: CompileResult, beh: BehaviorResult, code: string, add: Add) {
  add({ id: 'beh.run', section: 'behavior', label: '실행 중 오류 없음', weight: 3, ok: !beh.error, message: beh.error ?? undefined })
  const [A, B] = problem.sensors
  const g = beh.grid
  const cards = problem.cards.map((c) => c.cardId)
  // 3단계/PWM 카드의 대상 센서는 LED 시그니처를 바꾸는 것으로 충분하다
  const okA = affects(g, 'A')
  add({
    id: `beh.affect.${A}`, section: 'behavior', label: `${sensorName(A)} 값이 LED 에 영향을 줌`, weight: 9, ok: okA,
    message: okA ? undefined : `${sensorName(A)} 값을 바꿔도 LED 가 변하지 않아요. 읽은 값을 if 조건에 썼는지 확인하세요.${thresholdHint(code, A)}`,
  })
  if (B) {
    const okB = affects(g, 'B')
    add({
      id: `beh.affect.${B}`, section: 'behavior', label: `${sensorName(B)} 값이 LED 에 영향을 줌`, weight: 9, ok: okB,
      message: okB ? undefined : `${sensorName(B)} 값이 LED 에 반영되지 않아요. 두 센서 조건을 모두 if 에 넣었는지 확인하세요.${thresholdHint(code, B)}`,
    })
  }
  // LED 가 실제로 켜지고 꺼지는가
  const ledMsg: string[] = []
  problem.leds.forEach((l, k) => {
    const all = g.flat().map((w) => w.sig[k])
    const set = new Set(all)
    if (set.size < 2) ledMsg.push(`LED${problem.leds.length > 1 ? k + 1 : ''}(${l.pin}) 가 ${set.has('0') ? '항상 꺼져' : set.has('1') ? '항상 켜져' : '항상 같은 상태로'} 있어요.`)
  })
  add({ id: 'beh.leds', section: 'behavior', label: problem.leds.length > 1 ? '모든 LED 가 켜지고 꺼짐' : 'LED 가 켜지고 꺼짐', weight: 6, ok: ledMsg.length === 0, message: ledMsg.join('\n') || undefined })

  // 카드 규칙
  for (const c of problem.cards) {
    for (const rule of cardRules(c)) {
      const r = checkRule(rule, c, problem, compiled, beh)
      if (!r) continue
      add({ id: `card.${c.cardId}.${rule.kind}`, section: r.section ?? 'behavior', label: `🃏 ${cardTitle(c)}`, weight: 6, ok: r.ok, message: r.msg })
    }
  }
  void cards
}

interface RuleResult { ok: boolean; msg?: string; section?: Section }

function checkRule(rule: CardRule, c: AppliedCard, problem: Problem, compiled: CompileResult, beh: BehaviorResult): RuleResult | null {
  const g = beh.grid
  const [A, B] = problem.sensors
  const T = c.target ?? B ?? A
  // T 가 A 축인지 B 축인지
  const tAxisA = T === A
  const on = (w: WindowResult, k = 0) => w.sig[k] !== '0'
  switch (rule.kind) {
    case 'codeCalls': return null
    case 'serialIncludesBothValues': {
      const r = checkSerialBoth(problem, beh)
      return { ok: r.ok, msg: r.msg }
    }
    case 'periodicSerial': {
      const h = new Harness(compiled, beh.modelCircuit, problem)
      h.run(21500)
      const chunks = h.board.serialOut.filter((x) => x.text.trim())
      const bursts: number[] = []
      for (const ch of chunks) if (!bursts.length || ch.t - bursts[bursts.length - 1] > 400_000) bursts.push(ch.t)
      // setup 출력(기준값 등)은 빼고 본다
      const loopBursts = bursts.filter((t) => t > 300_000)
      const gaps = loopBursts.slice(1).map((t, i) => (t - loopBursts[i]) / 1000)
      const ok = gaps.length >= 2 && gaps.every((x) => Math.abs(x - rule.periodMs) <= rule.periodMs * rule.tolerance)
      const avg = gaps.length ? Math.round(gaps.reduce((s, x) => s + x, 0) / gaps.length) : 0
      return {
        ok,
        msg: ok ? undefined : !chunks.length ? '시리얼 출력이 없어요.' : gaps.length < 2 ? '출력이 5초 간격으로 반복되지 않아요.' : `출력 간격이 약 ${(avg / 1000).toFixed(1)}초예요. 5초마다 한 번씩 출력해야 해요.`,
      }
    }
    case 'levelIndicator': {
      // T 를 바꿀 때 LED 3개의 켜짐 패턴이 3가지 이상
      const lines = tAxisA ? (g[0] ?? []).map((_, j) => g.map((row) => row[j])) : g
      let best = 0
      for (const line of lines) {
        const pats = new Set(line.filter(Boolean).map((w) => w.sig.map((s) => (s !== '0' ? 1 : 0)).join('')).filter((p) => p.includes('1')))
        best = Math.max(best, pats.size)
      }
      return { ok: best >= 3, msg: best >= 3 ? undefined : `${sensorName(T)} 값에 따라 LED 3개가 3단계(낮음/보통/높음)로 바뀌지 않아요 (지금 ${best}단계).` }
    }
    case 'onOffAndPwm': {
      const O = problem.sensors.find((s) => s !== T)!
      // T 축을 따라가는 줄들 (O 상태별)
      const byO: WindowResult[][] = tAxisA ? (g[0] ?? []).map((_, j) => g.map((row) => row[j])) : g
      const levels = byO.map((line) => new Set(line.filter(Boolean).map((w) => w.leds[0].avg).filter((a) => a > 0.03 && a < 0.97).map((a) => Math.round(a * 32))).size)
      const allOff = byO.some((line) => line.every((w) => !w || w.leds[0].avg < 0.03))
      const pwmOk = Math.max(0, ...levels) >= 3
      const msg = !pwmOk ? `${sensorName(T)} 값에 따라 LED 밝기(analogWrite 0~255)가 여러 단계로 바뀌지 않아요. map() 으로 밝기를 계산해 보세요.`
        : !allOff ? `${sensorName(O)} 조건이 거짓일 때 LED 가 꺼지지 않아요 (ON/OFF 역할).` : undefined
      return { ok: !msg, msg }
    }
    case 'edgeToggle': {
      const O = problem.sensors.find((s) => s !== T)
      const tKey = `${T}.${getSensor(T).controls[0].key}`
      const oStates = O ? sensorStates(O) : [{}]
      for (const os of oStates) {
        const h = new Harness(compiled, beh.modelCircuit, problem, { ...os, [tKey]: 0 })
        const seq = [0, 1, 0, 1, 0]
        const states = seq.map((v) => {
          const w = h.window({ [tKey]: v }, 700, 600)
          return w.leds[0].toggles >= 2 ? 'B' : w.leds[0].avg > 0.5 ? '1' : '0'
        })
        if (states.includes('B')) continue
        const [s0, s1, s2, s3, s4] = states
        const rising = s1 !== s0 && s2 === s1 && s3 !== s2 && s4 === s3
        const falling = s1 === s0 && s2 !== s1 && s3 === s2 && s4 !== s3
        if (rising || falling) return { ok: true }
      }
      return { ok: false, msg: `${sensorName(T)} 가 감지되는 순간마다 LED 가 켜짐↔꺼짐으로 바뀌어야 해요. 이전 값을 저장해 두고 값이 바뀔 때만 상태를 뒤집으세요 (ledState = !ledState).` }
    }
    case 'calibration': {
      const readInSetup = [...beh.trace.values()].some((t) => t.phase === 'setup' && ['digitalRead', 'analogRead', 'pulseIn', 'dht'].includes(t.name) && sensorPins(problem, T).includes(t.pin ?? -1))
      if (!readInSetup) return { ok: false, msg: `setup() 에서 ${josa(sensorName(T), '을를')} 한 번 읽어서 기준값을 정해야 해요.`, section: 'code' }
      const ctl = getSensor(T).controls[0]
      const key = `${T}.${ctl.key}`
      const alt = [...ctl.testValues].sort((a, b) => Math.abs(b - ctl.default) - Math.abs(a - ctl.default))[0]
      const O = problem.sensors.find((s) => s !== T)
      const oStates = O ? sensorStates(O) : [{}]
      const sweep = (init: number) => {
        const h = new Harness(compiled, beh.modelCircuit, problem, { [key]: init })
        const out: string[] = []
        const { settle } = timing(problem)
        h.run(settle) // setup 이 시작값을 읽도록 먼저 실행
        for (const os of oStates) for (const v of ctl.testValues) out.push(h.window({ ...os, [key]: v }, settle, 600).sig.join())
        return out.join('|')
      }
      const ok = sweep(ctl.default) !== sweep(alt)
      return { ok, msg: ok ? undefined : '시작할 때 읽은 값이 달라져도 LED 가 반응하는 기준이 그대로예요. setup 에서 읽은 값으로 임계값 변수를 정하고 loop 에서 그 변수와 비교하세요.' }
    }
    case 'logic': {
      if (!B) return null
      const M = g.map((row) => row.map((w) => on(w)))
      const I = M.length
      const J = M[0].length
      let ok: boolean
      if (rule.op === 'AND') {
        const SA = M.map((row) => row.some(Boolean))
        const SB = M[0].map((_, j) => M.some((row) => row[j]))
        ok = M.every((row, i) => row.every((v, j) => v === (SA[i] && SB[j])))
        ok &&= SA.some(Boolean) && !SA.every(Boolean) && SB.some(Boolean) && !SB.every(Boolean)
      } else {
        const SA = M.map((row) => row.every(Boolean))
        const SB = M[0].map((_, j) => M.every((row) => row[j]))
        ok = M.every((row, i) => row.every((v, j) => v === (SA[i] || SB[j])))
        ok &&= SA.some(Boolean) && !SA.every(Boolean) && SB.some(Boolean) && !SB.every(Boolean)
      }
      void I; void J
      return {
        ok,
        msg: ok ? undefined : rule.op === 'AND'
          ? `두 센서가 모두 조건을 만족할 때만 LED 가 켜져야 해요. if (조건A && 조건B) 를 쓰세요.`
          : `둘 중 하나라도 조건을 만족하면 LED 가 켜져야 해요. if (조건A || 조건B) 를 쓰세요.`,
      }
    }
    case 'blinkWhenActive': {
      const sigs = g.flat().map((w) => w.sig[0])
      const ok = sigs.includes('B') && sigs.includes('0') && sigs.every((s) => s === 'B' || s === '0')
      const msg = ok ? undefined : !sigs.includes('B') ? '조건을 만족해도 LED 가 깜빡이지 않아요. HIGH → delay → LOW → delay 를 쓰세요.' : sigs.includes('1') ? '조건을 만족하지 않을 때 LED 가 켜져 있어요. 꺼져 있어야 해요.' : '조건을 만족하지 않을 때 LED 가 꺼지지 않아요.'
      return { ok, msg }
    }
    case 'twoLeds': {
      if (problem.leds.length < 2) return null
      if (rule.mode === 'opposite') {
        const all = g.flat()
        const ok = all.every((w) => (w.sig[0] === '0') !== (w.sig[1] === '0')) && new Set(all.map((w) => w.sig[0])).size > 1
        return { ok, msg: ok ? undefined : '두 LED 가 항상 반대로(하나가 켜지면 다른 하나는 꺼짐) 동작해야 해요.' }
      }
      // 독립: LED k 는 한 센서에만 반응
      const depends = (k: number) => {
        const byA = g.some((row) => new Set(row.map((w) => w.sig[k])).size > 1) // B 를 바꾸면 변함
        const byB = (g[0] ?? []).some((_, j) => new Set(g.map((row) => row[j].sig[k])).size > 1) // A 를 바꾸면 변함
        return { a: byB, b: byA }
      }
      const d0 = depends(0)
      const d1 = depends(1)
      const ok = (d0.a && !d0.b && d1.b && !d1.a) || (d0.b && !d0.a && d1.a && !d1.b)
      return { ok, msg: ok ? undefined : `LED1 은 ${sensorName(A)}, LED2 는 ${sensorName(B ?? A)} 로 따로따로 제어해야 해요.` }
    }
  }
  return null
}

function sensorPins(problem: Problem, id: SensorId) {
  return Object.values(problem.pins[id] ?? {}).map(pinNum)
}

/** 시리얼 출력에 두 센서 값이 모두 들어 있는가 */
function checkSerialBoth(problem: Problem, beh: BehaviorResult): { ok: boolean; msg?: string } {
  const g = beh.grid
  const all = g.flat()
  const anyOut = all.some((w) => w.serial.some((s) => s.text.trim()))
  if (!anyOut) {
    const begun = [...beh.trace.values()].some((t) => t.name === 'Serial.begin')
    return { ok: false, msg: begun ? '시리얼 모니터에 아무것도 출력되지 않아요.' : 'Serial.begin(9600) 이 없어요. setup 에 넣고 Serial.print 로 값을 출력하세요.' }
  }
  const missing: string[] = []
  problem.sensors.forEach((id, axis) => {
    if (!printed(problem, beh, id, axis === 0 ? 'A' : 'B')) missing.push(sensorName(id))
  })
  return { ok: missing.length === 0, msg: missing.length ? `시리얼 출력에 ${missing.join(', ')} 값이 없어요. Serial.print 로 함께 출력하세요.` : undefined }
}

function printed(problem: Problem, beh: BehaviorResult, id: SensorId, axis: 'A' | 'B'): boolean {
  const g = beh.grid
  const s = getSensor(id)
  const numbers = (w: WindowResult) => (serialText(w.serial).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  const windows = g.flat().filter((w) => w.serial.some((x) => x.text.trim()))
  if (!windows.length) return false
  if (s.continuous) {
    let hits = 0
    for (const w of windows) {
      const nums = numbers(w)
      const exp = expectedValues(problem, id, w.values)
      if (exp.some((e) => nums.some((n) => Math.abs(n - e.v) <= e.tol))) hits++
    }
    return hits >= windows.length * 0.7
  }
  // 디지털 센서: 그 센서만 바꿨을 때 출력 내용이 바뀌는가
  const lines = (w: WindowResult) => serialText(w.serial).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-1)[0] ?? ''
  if (axis === 'A') {
    for (let j = 0; j < (g[0]?.length ?? 0); j++) {
      const set = new Set(g.map((row) => row[j]).filter((w) => w?.serial.length).map(lines))
      if (set.size > 1) return true
    }
    return false
  }
  return g.some((row) => new Set(row.filter((w) => w.serial.length).map(lines)).size > 1)
}

function expectedValues(problem: Problem, id: SensorId, values: Record<string, number>): { v: number; tol: number }[] {
  switch (id) {
    case 'ultrasonic': return [{ v: values['ultrasonic.distance'], tol: 1.5 }]
    case 'dht11': return [{ v: values['dht11.temperature'], tol: 0.6 }, { v: values['dht11.humidity'], tol: 0.6 }]
    case 'cds': {
      const b = new SimBoard(buildModelCircuit(problem), values)
      return [{ v: b.analogRead(pinNum(problem.pins.cds!.a0)), tol: 3 }]
    }
    default: return []
  }
}

/** 화면용: 원하는 핀 → 아두이노 노드 표시 (테스트 편의) */
export const _internal = { nodeToPinNumber }
