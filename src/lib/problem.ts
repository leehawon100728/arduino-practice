import type {
  AppliedCard, ArduinoPin, CardDef, Difficulty, DigitalPin, LedColor, Mode, Problem, ProblemLed, SensorId,
} from '../types'
import { SENSOR_IDS, getSensor, PWM_PINS } from '../data/sensors'
import { CARDS, CARD_MAP } from '../data/cards'
import { DIFFICULTIES, EXAM_CARD_COUNT } from '../data/difficulty'
import { josa } from './josa'

// ─── 시드 난수 ────────────────────────────────────────────────

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export type Rng = () => number

export const randInt = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1))
export const pick = <T,>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)]
export function shuffle<T>(rng: Rng, list: readonly T[]): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
export const newSeed = () => Math.floor(Math.random() * 2 ** 31)

// ─── 조합 ────────────────────────────────────────────────────

/** 21가지 센서 조합 (순서 고정: SENSORS 배열 순) */
export const ALL_COMBOS: [SensorId, SensorId][] = (() => {
  const out: [SensorId, SensorId][] = []
  for (let i = 0; i < SENSOR_IDS.length; i++)
    for (let j = i + 1; j < SENSOR_IDS.length; j++) out.push([SENSOR_IDS[i], SENSOR_IDS[j]])
  return out
})()

export const comboKey = (ids: SensorId[]) => [...ids].sort().join('+')

// ─── 핀 배정 ─────────────────────────────────────────────────

const ALL_DIGITAL: DigitalPin[] = ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13']
const ALL_ANALOG: ArduinoPin[] = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']
/** LED 는 PWM 핀을 우선 쓴다 (11 이 기본, 외부 LED 템플릿과 동일) */
const LED_PIN_ORDER: DigitalPin[] = ['D11', 'D6', 'D5', 'D3', 'D10', 'D9', 'D12', 'D13', 'D8', 'D7']
const LED_COLORS: LedColor[] = ['red', 'green', 'blue']

export interface PinPlan {
  pins: Problem['pins']
  leds: ProblemLed[]
}

/**
 * 센서 신호와 LED 에 핀을 배정한다.
 * - 기본 핀이 비어 있으면 기본 핀, 겹치면 altPins 순서대로.
 * - randomPins=true(Lv3) 면 같은 종류(디지털/아날로그)의 빈 핀 중 랜덤.
 * - 선택 신호(required=false)도 핀을 배정해 문제에 표시한다.
 */
export function assignPins(
  sensors: SensorId[], ledCount: number, opts: { randomPins: boolean; pwmLeds: boolean; rng: Rng },
): PinPlan {
  const used = new Set<ArduinoPin>()
  const pins: Problem['pins'] = {}

  for (const id of sensors) {
    const map: Record<string, ArduinoPin> = {}
    for (const sig of getSensor(id).signals) {
      let candidates: ArduinoPin[]
      if (opts.randomPins) {
        const pool = sig.pinType === 'analog' ? ALL_ANALOG : ALL_DIGITAL
        // LED 용 PWM 핀을 남겨 두기 위해 11 은 센서에 주지 않는다
        candidates = shuffle(opts.rng, pool.filter((p) => p !== 'D11'))
      } else {
        candidates = [sig.defaultPin, ...sig.altPins]
      }
      const chosen = candidates.find((p) => !used.has(p))
      if (!chosen) throw new Error(`핀 배정 실패: ${id}.${sig.key}`)
      used.add(chosen)
      map[sig.key] = chosen
    }
    pins[id] = map
  }

  const leds: ProblemLed[] = []
  let order = LED_PIN_ORDER
  if (opts.randomPins) {
    const pwm = shuffle(opts.rng, PWM_PINS as readonly DigitalPin[])
    const rest = shuffle(opts.rng, ALL_DIGITAL.filter((p) => !PWM_PINS.includes(p as never)))
    order = [...pwm, ...rest]
  }
  if (opts.pwmLeds) order = order.filter((p) => PWM_PINS.includes(p as never))
  for (let i = 0; i < ledCount; i++) {
    const pin = order.find((p) => !used.has(p))
    if (!pin) throw new Error('LED 핀 배정 실패')
    used.add(pin)
    leds.push({ id: `led${i + 1}`, color: LED_COLORS[i % LED_COLORS.length], pin })
  }
  return { pins, leds }
}

// ─── 카드 선택 ───────────────────────────────────────────────

function cardTargetOk(card: CardDef, sensor: SensorId) {
  const s = getSensor(sensor)
  if (card.target === 'continuous') return s.continuous
  if (card.target === 'digital') return !s.continuous
  return true
}

/** 카드가 이 센서 조합에 적용 가능하면 대상 센서 후보를 돌려준다 */
export function cardTargets(card: CardDef, sensors: SensorId[]): SensorId[] {
  if (!card.target || card.target === 'any') return sensors
  return sensors.filter((s) => cardTargetOk(card, s))
}

export function pickCards(
  rng: Rng, sensors: SensorId[], difficulty: Difficulty, count: number, exclude: string[] = [],
): AppliedCard[] {
  const chosen: AppliedCard[] = []
  const pool = shuffle(rng, CARDS.filter((c) => c.minDifficulty <= difficulty && !exclude.includes(c.id)))
  for (const card of pool) {
    if (chosen.length >= count) break
    if (sensors.length < 2 && (card.id === 'logic' || card.id === 'serial-both')) continue
    const targets = cardTargets(card, sensors)
    if (targets.length === 0) continue
    const clash = chosen.some((c) => card.conflictsWith.includes(c.cardId) || CARD_MAP[c.cardId].conflictsWith.includes(card.id))
    if (clash) continue
    const applied: AppliedCard = { cardId: card.id }
    if (card.target && card.target !== 'any') applied.target = pick(rng, targets)
    if (card.variants) applied.variantId = pick(rng, card.variants).id
    chosen.push(applied)
  }
  return chosen
}

// ─── 문제 생성 ───────────────────────────────────────────────

export interface ProblemOptions {
  mode: Mode
  sensors: SensorId[]
  difficulty: Difficulty
  seed: number
  /** 실전 모드 타이머 (분). 없으면 난이도 기본값, 연습 모드는 null */
  timerMinutes?: number | null
  irActiveLow?: boolean
  /** 카드 직접 지정 (테스트/재도전용). 없으면 랜덤 */
  cards?: AppliedCard[]
}

/** 화면 표기: D9, A0 (그대로) */
export const pinLabel = (pin: ArduinoPin) => pin

/** 코드에 들어갈 핀 표기: D9 → 9, A0 → A0 */
export function pinCode(pin: ArduinoPin) {
  return pin.startsWith('D') ? pin.slice(1) : pin
}

export function generateProblem(o: ProblemOptions): Problem {
  const rng = mulberry32(o.seed)
  const diff = DIFFICULTIES[o.difficulty]
  const isExam = o.mode === 'exam'

  // 1) 카드
  let cards: AppliedCard[]
  if (o.cards) cards = o.cards
  else {
    const [lo, hi] = isExam ? EXAM_CARD_COUNT[o.difficulty] : diff.cardCount
    const exclude = diff.requireSerial ? ['serial-both'] : [] // Lv2+ 는 이미 기본 요구
    cards = pickCards(rng, o.sensors, o.difficulty, randInt(rng, lo, hi), exclude)
  }

  // 2) LED 수 / PWM 요구
  let ledCount = o.sensors.length === 1 ? 1 : diff.ledCount
  let pwmLeds = false
  for (const c of cards) {
    const def = CARD_MAP[c.cardId]
    if (def.requiresLeds) ledCount = Math.max(ledCount, def.requiresLeds)
    if (def.requiresPwmLed) pwmLeds = true
  }

  // 3) 핀
  const { pins, leds } = assignPins(o.sensors, ledCount, { randomPins: diff.randomPins, pwmLeds, rng })

  const timeLimitSec = isExam
    ? (o.timerMinutes ?? diff.examMinutes) * 60
    : o.difficulty === 3 ? diff.examMinutes * 60 : null

  const problem: Problem = {
    key: problemKey(o),
    mode: o.mode,
    difficulty: o.difficulty,
    seed: o.seed,
    sensors: o.sensors,
    pins,
    leds,
    cards,
    irActiveLow: o.irActiveLow ?? true,
    buttonMode: 'pulldown',
    requireSerial: diff.requireSerial,
    showWiringGuide: diff.showWiringGuide && !isExam,
    allowHints: diff.allowHints,
    hintPenalty: diff.hintPenalty,
    timeLimitSec,
    lockSolutionUntilSubmit: isExam,
    title: '',
    statement: [],
  }
  problem.title = o.sensors.map((s) => getSensor(s).name).join(' + ')
  problem.statement = buildStatement(problem)
  return problem
}

export function problemKey(o: Pick<ProblemOptions, 'mode' | 'sensors' | 'difficulty' | 'seed'>) {
  return `${o.mode}-${o.sensors.join('.')}-lv${o.difficulty}-${o.seed}`
}

// ─── 문제 문장 ───────────────────────────────────────────────

export function sensorPinText(p: Problem, id: SensorId) {
  const s = getSensor(id)
  const map = p.pins[id] ?? {}
  return s.signals
    .map((sig) => `${sig.label} → ${pinLabel(map[sig.key])}${sig.required ? '' : ' (선택)'}`)
    .join(', ')
}

export function fillCardText(text: string, p: Problem, card: AppliedCard) {
  const [a, b] = p.sensors
  const names: Record<string, string> = {
    A: getSensor(a).name,
    B: getSensor(b ?? a).name,
    T: getSensor(card.target ?? b ?? a).name,
    O: getSensor(p.sensors.find((x) => x !== (card.target ?? b ?? a)) ?? a).name,
  }
  return text.replace(/\{([ABTO])(?::([^}]+))?\}/g, (_, k: string, j?: string) => (j ? josa(names[k], j) : names[k]))
}

export function cardText(p: Problem, c: AppliedCard) {
  const def = CARD_MAP[c.cardId]
  const variant = def.variants?.find((v) => v.id === c.variantId)
  const desc = variant ? variant.description : def.description
  return {
    title: variant ? `${def.title} · ${variant.label}` : def.title,
    description: fillCardText(desc, p, c),
    tip: def.tip,
    number: def.number,
  }
}

function buildStatement(p: Problem): string[] {
  const lines: string[] = []
  const names = p.sensors.map((s) => getSensor(s).name)
  const ledText = p.leds.map((l, i) => `LED${p.leds.length > 1 ? i + 1 : ''}(${l.pin})`).join(', ')
  if (p.sensors.length === 1) {
    lines.push(`${names[0]}의 값을 읽어 ${ledText}를 제어하세요. 조건은 자유롭게 정해도 됩니다.`)
  } else {
    lines.push(`${josa(names[0], '와과')} ${names[1]}의 값을 모두 읽어 ${ledText}를 제어하세요. 조건은 자유롭게 정해도 되지만, 두 센서 값이 모두 LED 에 영향을 줘야 합니다.`)
  }
  for (const id of p.sensors) lines.push(`• ${getSensor(id).name}: ${sensorPinText(p, id)}`)
  if (p.sensors.includes('ir')) {
    lines.push(`• 이 문제의 IR 센서는 장애물 감지 시 ${p.irActiveLow ? 'LOW' : 'HIGH'} 를 출력합니다.`)
  }
  if (p.requireSerial && p.sensors.length > 1) {
    lines.push('• 두 센서 값을 시리얼 모니터에 함께 출력하세요.')
  }
  return lines
}
