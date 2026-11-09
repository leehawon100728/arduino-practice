import type { AppliedCard, Problem, SensorId, SensorSnippet } from '../types'
import { getSensor } from '../data/sensors'
import { CARD_MAP } from '../data/cards'
import { pinCode } from './problem'

// ─────────────────────────────────────────────────────────────
// 모범답안 자동 합성
// 센서별 조각(sensors.ts 의 snippet) + 아래 SOLUTION_EXTRAS 를 조합해
// 가장 쉬운 코드(전역 변수, if/else, 한국어 주석)를 만든다.
// ─────────────────────────────────────────────────────────────

export interface SensorExtra {
  /** 조건 bool 변수 이름 */
  condName: string
  /** 3단계 표시 기준 [낮음/보통 경계, 보통/높음 경계] */
  levels?: { varName: string; lo: number; hi: number; unit: string }
  /** 밝기(PWM) 변환 */
  pwm?: { expr: string; desc: string }
  /** 임계값 자동 보정: setup 에서 읽은 값으로 기준 정하기 */
  calibration?: { setExpr: string; cond: string; desc: string }
}

export const SOLUTION_EXTRAS: Record<SensorId, SensorExtra> = {
  pir: { condName: 'isMotion' },
  dht11: {
    condName: 'isHot',
    levels: { varName: 'temperature', lo: 20, hi: 28, unit: '°C' },
    pwm: { expr: 'map(temperature, 0, 50, 0, 255)', desc: '온도가 높을수록 밝게' },
    calibration: { setExpr: 'threshold = temperature + 3;', cond: 'temperature >= threshold', desc: '시작 온도보다 3°C 이상 오르면' },
  },
  ultrasonic: {
    condName: 'isNear',
    levels: { varName: 'distance', lo: 20, hi: 50, unit: 'cm' },
    pwm: { expr: 'map(distance, 2, 100, 255, 0)', desc: '가까울수록 밝게' },
    calibration: { setExpr: 'threshold = distance - 20;', cond: 'distance < threshold', desc: '시작 거리보다 20cm 이상 가까워지면' },
  },
  button: { condName: 'isPressed' },
  cds: {
    condName: 'isDark',
    levels: { varName: 'cdsValue', lo: 300, hi: 700, unit: '' },
    pwm: { expr: 'map(cdsValue, 0, 1023, 0, 255)', desc: '어두울수록 밝게' },
    calibration: { setExpr: 'threshold = cdsValue + 150;', cond: 'cdsValue > threshold', desc: '시작할 때보다 150 이상 어두워지면' },
  },
  line: { condName: 'isWhite' },
  pot: {
    condName: 'isHigh',
    levels: { varName: 'potValue', lo: 341, hi: 682, unit: '' },
    pwm: { expr: 'map(potValue, 0, 1023, 0, 255)', desc: '손잡이를 돌릴수록 밝게' },
    calibration: { setExpr: 'threshold = potValue + 150;', cond: 'potValue > threshold', desc: '시작할 때보다 150 이상 돌리면' },
  },
}

export interface ComposeOptions {
  /** 기본 논리 (카드가 없을 때) */
  logic?: 'AND' | 'OR'
  /** 센서별 대체 방식 (sensors.ts alternatives 의 index) */
  alt?: Partial<Record<SensorId, number>>
  /** 5초 출력 카드의 쉬운 버전 (loop 횟수 세기) */
  easyPeriodic?: boolean
}

const IND = '  '

function fill(text: string, p: Problem, id: SensorId) {
  const pins = p.pins[id] ?? {}
  return text
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) => (pins[k] ? pinCode(pins[k]) : '?'))
}

const indent = (text: string, n = 1) => text.split('\n').map((l) => (l ? IND.repeat(n) + l : l)).join('\n')

function snippetOf(p: Problem, id: SensorId, opts: ComposeOptions): SensorSnippet {
  const s = getSensor(id)
  const altIdx = opts.alt?.[id]
  if (altIdx !== undefined && s.alternatives[altIdx]) return s.alternatives[altIdx].snippet
  if (id === 'button' && p.buttonMode === 'pullup') return s.alternatives[0].snippet
  return s.snippet
}

export function cardOf(p: Problem, id: string): AppliedCard | undefined {
  return p.cards.find((c) => c.cardId === id)
}

export function composeSolution(p: Problem, opts: ComposeOptions = {}): string {
  const sensors = p.sensors
  const [A, B] = sensors
  const snip = Object.fromEntries(sensors.map((id) => [id, snippetOf(p, id, opts)])) as Record<SensorId, SensorSnippet>
  const has = (id: string) => !!cardOf(p, id)
  const logicCard = cardOf(p, 'logic')
  const op = logicCard?.variantId === 'or' ? 'OR' : logicCard ? 'AND' : opts.logic ?? 'AND'
  const three = cardOf(p, 'three-level')
  const pwmCard = cardOf(p, 'onoff-pwm')
  const edge = cardOf(p, 'edge-toggle')
  const calib = cardOf(p, 'calibration')
  const twoLeds = cardOf(p, 'two-leds')
  const blink = has('blink')
  const periodic = has('every-5s')
  const wantSerial = p.requireSerial || has('serial-both') || periodic
  const other = (t?: SensorId) => sensors.find((s) => s !== t)

  const leds = p.leds
  const ledVar = (i: number) => (leds.length === 1 ? 'ledPin' : `ledPin${i + 1}`)

  const condExpr = (id: SensorId) => {
    if (calib?.target === id) return SOLUTION_EXTRAS[id].calibration!.cond
    return fill(snip[id].condition.expr, p, id)
  }
  const condDesc = (id: SensorId) => (calib?.target === id ? SOLUTION_EXTRAS[id].calibration!.desc : snip[id].condition.desc)
  const cn = (id: SensorId) => SOLUTION_EXTRAS[id].condName

  // ── 맨 위 ──
  const out: string[] = []
  out.push(`// ===== 모범답안: ${p.title} =====`)
  const includes = [...new Set(sensors.flatMap((id) => snip[id].includes))]
  if (includes.length) out.push(...includes, '')

  for (const id of sensors) {
    out.push(`// ── ${getSensor(id).name} ──`)
    out.push(fill(snip[id].globals, p, id), '')
  }
  out.push('// ── LED ──')
  leds.forEach((l, i) => out.push(`const int ${ledVar(i)} = ${pinCode(l.pin)};${' '.repeat(Math.max(1, 10 - ledVar(i).length))}// LED${leds.length > 1 ? i + 1 : ''} 핀${pwmCard ? ' (~ PWM 핀)' : ''}`))
  if (calib) out.push('int threshold = 0;          // 시작할 때 자동으로 정하는 기준값')
  if (edge) {
    out.push('bool ledState = false;      // LED 켜짐/꺼짐 상태 (토글)')
    out.push('bool lastActive = false;    // 지난번 감지 상태 (엣지 감지용)')
  }
  if (periodic) {
    out.push(opts.easyPeriodic ? 'int loopCount = 0;          // loop 가 몇 번 돌았는지 세기' : 'unsigned long lastPrintTime = 0;   // 마지막으로 출력한 시각 (ms)')
  }
  out.push('')

  // ── setup ──
  out.push('void setup() {')
  if (wantSerial) out.push(`${IND}Serial.begin(9600);         // 시리얼 통신 시작`)
  for (const id of sensors) if (snip[id].setup) out.push(indent(fill(snip[id].setup, p, id)))
  leds.forEach((_, i) => out.push(`${IND}pinMode(${ledVar(i)}, OUTPUT);${' '.repeat(Math.max(1, 12 - ledVar(i).length))}// LED 핀은 출력`))
  if (calib) {
    const t = calib.target!
    out.push('', `${IND}// 시작할 때 ${getSensor(t).name} 값을 읽어서 기준값을 정해요`)
    out.push(indent(fill(snip[t].read, p, t)))
    out.push(`${IND}${SOLUTION_EXTRAS[t].calibration!.setExpr}   // ${SOLUTION_EXTRAS[t].calibration!.desc} 반응`)
    if (wantSerial) out.push(`${IND}Serial.print("기준값: ");`, `${IND}Serial.println(threshold);`)
  }
  out.push('}', '')

  // ── loop ──
  out.push('void loop() {')
  out.push(`${IND}// 1) 센서 값 읽기`)
  for (const id of sensors) out.push(indent(fill(snip[id].read, p, id)))
  out.push('')

  out.push(`${IND}// 2) 조건 정하기 (기준값은 자유롭게 바꿔도 돼요)`)
  for (const id of sensors) {
    if (three?.target === id || pwmCard?.target === id) continue
    out.push(`${IND}bool ${cn(id)} = (${condExpr(id)});${' '.repeat(Math.max(1, 26 - cn(id).length - condExpr(id).length))}// ${condDesc(id)}`)
  }
  if (edge) {
    const t = edge.target!
    out.push('')
    out.push(`${IND}// 감지 안 됨 → 감지됨 으로 바뀌는 순간에만 LED 상태를 뒤집어요`)
    out.push(`${IND}if (${cn(t)} == true && lastActive == false) {`)
    out.push(`${IND}${IND}ledState = !ledState;`)
    out.push(`${IND}}`)
    out.push(`${IND}lastActive = ${cn(t)};      // 지금 상태를 기억`)
  }
  out.push('')
  out.push(`${IND}// 3) LED 출력`)

  const w = (i: number, v: 'HIGH' | 'LOW', n = 2) => `${IND.repeat(n)}digitalWrite(${ledVar(i)}, ${v});`
  if (three) {
    const t = three.target!
    const o = other(t)
    const lv = SOLUTION_EXTRAS[t].levels!
    const body = (n: number) => [
      `${IND.repeat(n)}if (${lv.varName} < ${lv.lo}) {            // 낮음`,
      w(0, 'HIGH', n + 1), w(1, 'LOW', n + 1), w(2, 'LOW', n + 1),
      `${IND.repeat(n)}} else if (${lv.varName} < ${lv.hi}) {     // 보통`,
      w(0, 'LOW', n + 1), w(1, 'HIGH', n + 1), w(2, 'LOW', n + 1),
      `${IND.repeat(n)}} else {                       // 높음`,
      w(0, 'LOW', n + 1), w(1, 'LOW', n + 1), w(2, 'HIGH', n + 1),
      `${IND.repeat(n)}}`,
    ]
    if (o) {
      out.push(`${IND}if (${cn(o)}) {   // ${getSensor(o).name} 조건을 만족할 때만 3단계 표시`)
      out.push(...body(2))
      out.push(`${IND}} else {         // 아니면 모두 끄기`)
      out.push(w(0, 'LOW'), w(1, 'LOW'), w(2, 'LOW'))
      out.push(`${IND}}`)
    } else out.push(...body(1))
  } else if (pwmCard) {
    const t = pwmCard.target!
    const o = other(t)!
    const pw = SOLUTION_EXTRAS[t].pwm!
    out.push(`${IND}int brightness = ${pw.expr};   // ${pw.desc} (0~255)`)
    out.push(`${IND}brightness = constrain(brightness, 0, 255);   // 범위를 벗어나지 않게`)
    out.push(`${IND}if (${cn(o)}) {                      // ${getSensor(o).name} 가 켤지 끌지 결정`)
    out.push(`${IND}${IND}analogWrite(${ledVar(0)}, brightness);   // ${getSensor(t).name} 가 밝기 결정`)
    out.push(`${IND}} else {`)
    out.push(`${IND}${IND}analogWrite(${ledVar(0)}, 0);`)
    out.push(`${IND}}`)
    for (let i = 1; i < leds.length; i++) {
      out.push(`${IND}if (${cn(o)}) {   // LED${i + 1}: 꺼져 있을 때 켜지는 표시등`, w(i, 'LOW'), `${IND}} else {`, w(i, 'HIGH'), `${IND}}`)
    }
  } else if (twoLeds) {
    if (twoLeds.variantId === 'opposite') {
      const both = B ? `${cn(A)} && ${cn(B)}` : cn(A)
      out.push(`${IND}if (${both}) {   // 시소: 한쪽이 켜지면 다른 쪽은 꺼짐`)
      out.push(w(0, 'HIGH'), w(1, 'LOW'))
      out.push(`${IND}} else {`)
      out.push(w(0, 'LOW'), w(1, 'HIGH'))
      out.push(`${IND}}`)
    } else {
      out.push(...independent())
    }
  } else {
    // 기본: 두 조건을 묶어서 LED1 제어
    let combined: string
    if (edge) {
      const o = other(edge.target)
      combined = o ? `ledState == true && ${cn(o)}` : 'ledState == true'
    } else if (B) combined = op === 'OR' ? `${cn(A)} || ${cn(B)}` : `${cn(A)} && ${cn(B)}`
    else combined = cn(A)
    const comment = edge ? '토글 상태가 켜짐이고 다른 조건도 만족하면' : B ? (op === 'OR' ? '둘 중 하나라도 만족하면 (OR)' : '두 조건을 모두 만족하면 (AND)') : '조건을 만족하면'
    if (leds.length >= 2 && !blink && !edge && !logicCard) {
      out.push(...independent())
    } else {
      // LED2 이상: 조건과 반대로 켜지는 표시등
      for (let i = 1; i < leds.length; i++) {
        out.push(`${IND}if (${combined}) {   // LED${i + 1}: 조건을 만족하지 않을 때 켜지는 표시등`, w(i, 'LOW'), `${IND}} else {`, w(i, 'HIGH'), `${IND}}`)
      }
      out.push(`${IND}if (${combined}) {   // ${comment}`)
      if (blink) {
        out.push(`${w(0, 'HIGH')}    // 깜빡이기: 켜고`, `${IND}${IND}delay(200);`, `${w(0, 'LOW')}     // 끄고`, `${IND}${IND}delay(200);`)
      } else out.push(w(0, 'HIGH'))
      out.push(`${IND}} else {`)
      out.push(w(0, 'LOW'))
      out.push(`${IND}}`)
    }
  }

  function independent() {
    const lines: string[] = []
    sensors.slice(0, leds.length).forEach((id, i) => {
      lines.push(`${IND}if (${cn(id)}) {   // LED${i + 1} 은 ${getSensor(id).name} 로만 제어`, w(i, 'HIGH'), `${IND}} else {`, w(i, 'LOW'), `${IND}}`)
    })
    return lines
  }

  // ── 시리얼 출력 ──
  if (wantSerial) {
    out.push('')
    const printLines: string[] = []
    const vars = sensors.flatMap((id) => snip[id].valueVars)
    vars.forEach((v, i) => {
      const prefix = i === 0 ? '' : ' / '
      printLines.push(`Serial.print("${prefix}${v.label}: ");`)
      const last = i === vars.length - 1 && !periodic
      if (v.unit) {
        printLines.push(`Serial.print(${v.name});`)
        printLines.push(`Serial.${last ? 'println' : 'print'}(" ${v.unit}");`)
      } else printLines.push(`Serial.${last ? 'println' : 'print'}(${v.name});`)
    })
    if (periodic) {
      printLines.push('Serial.print(" / LED: ");')
      printLines.push(`Serial.println(digitalRead(${ledVar(0)}));   // 1 = 켜짐, 0 = 꺼짐`)
      if (opts.easyPeriodic) {
        const per = loopPeriodMs(p, snip)
        const count = Math.max(1, Math.round(5000 / per))
        out.push(`${IND}// 4) 5초마다 상태 출력 (쉬운 방법: loop 가 약 ${per}ms 마다 도니까 ${count}번째마다 출력)`)
        out.push(`${IND}loopCount++;`)
        out.push(`${IND}if (loopCount >= ${count}) {`)
        out.push(...printLines.map((l) => IND.repeat(2) + l))
        out.push(`${IND}${IND}loopCount = 0;`)
        out.push(`${IND}}`)
      } else {
        out.push(`${IND}// 4) 5초마다 상태 출력 (millis 로 시간 재기)`)
        out.push(`${IND}if (millis() - lastPrintTime >= 5000) {   // 5000ms 가 지났으면`)
        out.push(`${IND}${IND}lastPrintTime = millis();`)
        out.push(...printLines.map((l) => IND.repeat(2) + l))
        out.push(`${IND}}`)
      }
    } else {
      out.push(`${IND}// 4) 시리얼 모니터에 두 값 함께 출력`)
      out.push(...printLines.map((l) => IND + l))
    }
  }

  out.push('')
  const d = loopDelay(p, snip)
  out.push(`${IND}delay(${d});${d >= 2000 ? '   // DHT11 은 1~2초에 한 번만 읽을 수 있어요' : '   // 잠깐 쉬기'}`)
  out.push('}', '')
  return out.join('\n')
}

function loopDelay(p: Problem, snip: Record<string, SensorSnippet>) {
  return Math.max(...p.sensors.map((id) => snip[id].loopDelayMs))
}

/** 쉬운 5초 출력용: loop 한 번에 걸리는 대략적인 시간 */
function loopPeriodMs(p: Problem, snip: Record<string, SensorSnippet>) {
  let ms = loopDelay(p, snip)
  if (p.sensors.includes('dht11')) ms += snip.dht11.includes[0]?.includes('DHT11.h') ? 520 : 0
  return ms
}

// ─── 모범답안 묶음 (화면 표시용) ────────────────────────────

export interface SolutionVariant { id: string; title: string; description: string; code: string }

export function solutionVariants(p: Problem): SolutionVariant[] {
  const list: SolutionVariant[] = [{ id: 'main', title: '모범답안', description: '가장 쉬운 방법으로 쓴 정답 예시예요.', code: composeSolution(p) }]
  const B = p.sensors[1]
  const logicFree = B && !p.cards.some((c) => ['logic', 'three-level', 'onoff-pwm', 'two-leds', 'edge-toggle'].includes(c.cardId)) && p.leds.length === 1
  if (logicFree) {
    list.push({ id: 'or', title: 'OR 조건 버전', description: '두 조건 중 하나만 만족해도 LED 가 켜지는 버전 (||).', code: composeSolution(p, { logic: 'OR' }) })
  }
  if (p.cards.some((c) => c.cardId === 'every-5s')) {
    list.push({ id: 'easy5s', title: '5초 출력 쉬운 버전', description: 'millis 대신 loop 횟수를 세는 방법. 대략 5초마다 출력돼요.', code: composeSolution(p, { easyPeriodic: true }) })
  }
  for (const id of p.sensors) {
    const s = getSensor(id)
    s.alternatives.forEach((alt, i) => {
      if (id === 'button' && p.buttonMode === 'pullup') return
      list.push({ id: `${id}-alt${i}`, title: `${s.shortName}: ${alt.title}`, description: alt.description, code: composeSolution(p, { alt: { [id]: i } }) })
    })
  }
  return list
}

export function cardTitle(c: AppliedCard) {
  const d = CARD_MAP[c.cardId]
  const v = d.variants?.find((x) => x.id === c.variantId)
  return v ? `${d.title} · ${v.label}` : d.title
}
