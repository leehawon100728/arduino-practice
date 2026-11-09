// ─────────────────────────────────────────────────────────────
// 공통 데이터 스키마
// 센서 / 추가 요구 카드 / 문제 / 진행 기록의 모양을 정의한다.
// 실제 데이터는 src/data/*.ts 에 있다.
// ─────────────────────────────────────────────────────────────

export type SensorId = 'pir' | 'dht11' | 'ultrasonic' | 'button' | 'cds' | 'line' | 'pot'

/** 아두이노 UNO 핀 이름. D0/D1(시리얼)은 문제에 절대 배정하지 않는다. */
export type DigitalPin =
  | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8' | 'D9' | 'D10' | 'D11' | 'D12' | 'D13'
export type AnalogPin = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5'
export type ArduinoPin = DigitalPin | AnalogPin

/** 센서 값을 아두이노가 읽는 방법 */
export type ReadMethod = 'digitalRead' | 'analogRead' | 'pulseIn' | 'dht'

/** 센서 모듈의 물리 핀 (브레드보드 시뮬레이터에서 구멍에 꽂히는 다리) */
export interface ModulePin {
  id: string
  label: string
  role: 'vcc' | 'gnd' | 'signal' | 'passive'
}

/** 아두이노 핀과 연결되어야 하는 신호선 */
export interface SensorSignal {
  /** 코드 템플릿의 {{key}} 자리에 핀 번호가 들어간다 */
  key: string
  label: string
  /** 이 신호가 연결되는 모듈 핀 id (CDS 처럼 모듈이 아니면 null) */
  modulePin: string | null
  /** 아두이노 쪽에서 본 방향 */
  direction: 'input' | 'output'
  pinType: 'digital' | 'analog'
  defaultPin: ArduinoPin
  /** 기본 핀이 충돌할 때 순서대로 시도하는 대체 핀 */
  altPins: ArduinoPin[]
  /** false면 연결하지 않아도 감점하지 않는다 (예: 라인센서 A0) */
  required: boolean
  /** 허용되는 pinMode. analogRead 전용이면 빈 배열(설정 불필요) */
  allowedModes: ('INPUT' | 'OUTPUT' | 'INPUT_PULLUP')[]
}

/** 가상 센서 조작 패널의 컨트롤 */
export interface SensorControl {
  key: string
  label: string
  type: 'slider' | 'toggle' | 'momentary'
  min?: number
  max?: number
  step?: number
  unit?: string
  default: number
  /** toggle/momentary 의 ON/OFF 표시 문구 */
  onLabel?: string
  offLabel?: string
  /** 동작 검사에서 자동으로 바꿔 볼 값들 */
  testValues: number[]
}

/** 센서별 모범답안 조각. {{signalKey}} 는 문제 생성 시 치환된다. */
export interface SensorSnippet {
  includes: string[]
  globals: string
  setup: string
  read: string
  /** 대표 값 변수 이름 (시리얼 출력/조건에 사용) */
  valueVars: { name: string; label: string; unit: string }[]
  /** 조건식 예시. expr 은 C++ 식 */
  condition: { expr: string; desc: string }
  /** loop 끝에 필요한 최소 delay (ms). DHT11 은 2000 */
  loopDelayMs: number
}

export interface SensorAlternative {
  title: string
  description: string
  snippet: SensorSnippet
}

export interface SensorDef {
  id: SensorId
  name: string
  shortName: string
  model: string
  /** 목록 카드에 쓰는 이모지 */
  icon: string
  summary: string
  modulePins: ModulePin[]
  signals: SensorSignal[]
  /** 브레드보드에 함께 필요한 부품 */
  extraParts: { part: PartKind; note: string }[]
  readMethods: ReadMethod[]
  /** 값이 연속적인가 (3단계 표시/PWM/캘리브레이션 카드 적용 가능 여부) */
  continuous: boolean
  controls: SensorControl[]
  /** 동작 검사에서 '상식적인' 임계값 범위 */
  sensibleRange: { min: number; max: number; unit: string }
  snippet: SensorSnippet
  alternatives: SensorAlternative[]
  /** 센서 동작 원리, 나사/점퍼 설명 등 */
  notes: string[]
  /** 자주 하는 실수 3가지 */
  mistakes: [string, string, string]
  /** 시험에서 자주 틀리는 포인트 */
  examPitfalls: string[]
  /** 3단계 힌트: ① 개념 ② 구조/의사코드 ③ 거의 정답 */
  hints: [string, string, string]
}

export type PartKind =
  | SensorId
  | 'led-red' | 'led-green' | 'led-blue'
  | 'res-220' | 'res-10k'
  | 'pushbutton'
  | 'wire'

export type LedColor = 'red' | 'green' | 'blue'

// ─── 추가 요구 카드 ───────────────────────────────────────────

/**
 * 카드 규칙. 채점기(src/grading)가 kind 별로 구현한다.
 * 새 카드를 만들 때 기존 kind 를 조합하면 코드 수정 없이 추가할 수 있다.
 */
export type CardRule =
  /** 시리얼 출력에 두 센서 값이 모두 포함되는가 */
  | { kind: 'serialIncludesBothValues' }
  /** periodMs 마다 시리얼 출력이 나오는가 (허용 오차 tolerance 비율) */
  | { kind: 'periodicSerial'; periodMs: number; tolerance: number }
  /** target 센서 값에 따라 LED count 개가 단계적으로 켜지는가 */
  | { kind: 'levelIndicator'; count: number }
  /** onOff 센서는 LED 켜짐/꺼짐, pwm 센서는 analogWrite 밝기를 바꾸는가 */
  | { kind: 'onOffAndPwm' }
  /** target 센서의 변화(엣지)에서만 LED 가 토글되는가 */
  | { kind: 'edgeToggle' }
  /** setup 에서 target 센서를 읽어 임계값을 정하는가 */
  | { kind: 'calibration' }
  /** 두 센서 조건의 논리 결합 */
  | { kind: 'logic'; op: 'AND' | 'OR' }
  /** 조건 만족 시 LED 가 깜빡이는가 */
  | { kind: 'blinkWhenActive' }
  /** LED 2개의 관계 */
  | { kind: 'twoLeds'; mode: 'independent' | 'opposite' }
  /** 코드에 특정 함수 호출이 있는가 */
  | { kind: 'codeCalls'; fn: string; where?: 'setup' | 'loop' | 'any' }

export interface CardVariant {
  id: string
  label: string
  description: string
  rules: CardRule[]
}

export interface CardDef {
  id: string
  number: number
  title: string
  /** {A} {B} {T} 는 센서 이름으로 치환된다 (T = 대상 센서) */
  description: string
  /** 적용 가능한 최소 난이도 */
  minDifficulty: Difficulty
  /** 이 카드가 붙으면 필요한 LED 개수 (문제의 LED 수를 끌어올린다) */
  requiresLeds?: number
  /** LED 가 PWM(~) 핀에 있어야 하는가 */
  requiresPwmLed?: boolean
  /** 대상 센서(T) 조건 */
  target?: 'continuous' | 'digital' | 'any'
  /** 함께 붙을 수 없는 카드 id */
  conflictsWith: string[]
  rules: CardRule[]
  /** 랜덤으로 하나가 선택되는 변형 (예: AND / OR) */
  variants?: CardVariant[]
  /** 쉬운 해결 팁 */
  tip: string
}

// ─── 난이도 / 문제 ────────────────────────────────────────────

export type Difficulty = 1 | 2 | 3

export interface DifficultyDef {
  level: Difficulty
  name: string
  tagline: string
  ledCount: number
  showWiringGuide: boolean
  allowHints: boolean
  /** 힌트 단계 하나를 열 때 감점 */
  hintPenalty: number
  cardCount: [number, number]
  /** 시리얼 모니터로 두 센서 값 출력 의무 */
  requireSerial: boolean
  /** 핀을 기본 핀과 다르게 랜덤 배정 */
  randomPins: boolean
  /** 실전 모드 기본 시간 (분) */
  examMinutes: number
}

export type Mode = 'basics' | 'single' | 'combo' | 'exam' | 'review'

export interface AppliedCard {
  cardId: string
  variantId?: string
  /** 카드 대상 센서 (T) */
  target?: SensorId
}

export interface ProblemLed {
  id: string
  color: LedColor
  pin: DigitalPin
}

export interface Problem {
  /** URL 로 다시 만들 수 있는 고유 키 */
  key: string
  mode: Mode
  difficulty: Difficulty
  seed: number
  sensors: SensorId[]
  /** sensorId → signalKey → 배정된 핀 */
  pins: Partial<Record<SensorId, Record<string, ArduinoPin>>>
  leds: ProblemLed[]
  cards: AppliedCard[]
  /** 버튼 배선 방식 (모범답안 기준, 채점은 둘 다 허용) */
  buttonMode: 'pulldown' | 'pullup'
  requireSerial: boolean
  showWiringGuide: boolean
  allowHints: boolean
  hintPenalty: number
  /** 초 단위, null = 타이머 없음 */
  timeLimitSec: number | null
  /** 실전 모드: 제출 전 힌트/모범답안 잠금 */
  lockSolutionUntilSubmit: boolean
  title: string
  statement: string[]
}

// ─── 진행 기록 ────────────────────────────────────────────────

export interface AttemptRecord {
  id: string
  date: string
  mode: Mode
  difficulty: Difficulty
  sensors: SensorId[]
  cards: string[]
  score: number
  wiring: number
  code: number
  behavior: number
  hintsUsed: number
  durationSec: number
  /** 틀린 항목 id (약점 분석용) */
  failedChecks: string[]
}

export interface ProgressData {
  version: 1
  attempts: AttemptRecord[]
}
