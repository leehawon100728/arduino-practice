import type { CardDef } from '../types'

// ─────────────────────────────────────────────────────────────
// 추가 요구 카드 (돌발 조건)
// 새 카드 추가 방법:
//   1) 아래 배열에 항목을 추가한다 (id 는 고유하게).
//   2) rules 에 기존 CardRule kind 를 조합한다. (src/types.ts 의 CardRule 참고)
//   3) 새로운 kind 가 필요하면 types.ts 에 추가하고 src/grading 에 검사 로직을 만든다.
// description 의 {A} {B} 는 문제의 첫째/둘째 센서, {T} 는 카드 대상 센서, {O} 는 대상이 아닌 다른 센서 이름이다.
// 조사는 {A:은는} {B:이가} {T:을를} {A:와과} {B:으로로} 처럼 쓰면 받침에 맞게 자동으로 붙는다.
// ─────────────────────────────────────────────────────────────

export const CARDS: CardDef[] = [
  {
    id: 'serial-both',
    number: 1,
    title: '두 센서 값 시리얼 출력',
    description: '{A} 값과 {B} 값을 시리얼 모니터에 함께 출력하세요. (예: "거리: 12 cm / 밝기: 640")',
    minDifficulty: 1,
    target: 'any',
    conflictsWith: [],
    rules: [
      { kind: 'codeCalls', fn: 'Serial.begin', where: 'setup' },
      { kind: 'serialIncludesBothValues' },
    ],
    tip: 'setup 에 Serial.begin(9600); 을 넣고, loop 에서 Serial.print 로 값 두 개를 이어서 출력하세요.',
  },
  {
    id: 'every-5s',
    number: 2,
    title: '5초마다 상태 출력',
    description: '5초에 한 번씩 현재 센서 값과 LED 상태를 시리얼 모니터에 출력하세요.',
    minDifficulty: 2,
    target: 'any',
    conflictsWith: [],
    rules: [
      { kind: 'codeCalls', fn: 'Serial.begin', where: 'setup' },
      { kind: 'periodicSerial', periodMs: 5000, tolerance: 0.2 },
    ],
    tip: '쉬운 방법: 카운터 변수로 loop 횟수를 세서 일정 횟수마다 출력. 정석: millis() 로 마지막 출력 시각을 기억하세요.',
  },
  {
    id: 'three-level',
    number: 3,
    title: '3단계 상태 표시',
    description: '{T} 값을 기준으로 LED 3개로 낮음 / 보통 / 높음 을 표시하세요.',
    minDifficulty: 2,
    requiresLeds: 3,
    target: 'continuous',
    conflictsWith: ['onoff-pwm', 'two-leds', 'blink', 'logic', 'edge-toggle', 'calibration'],
    rules: [{ kind: 'levelIndicator', count: 3 }],
    tip: 'if / else if / else 로 세 구간을 나누고, 구간마다 LED 하나만 켜세요.',
  },
  {
    id: 'onoff-pwm',
    number: 4,
    title: 'ON/OFF + 밝기',
    description: '{O:은는} LED 를 켤지 끌지(ON/OFF)를, {T:은는} LED 밝기(PWM)를 정하게 하세요.',
    minDifficulty: 2,
    requiresPwmLed: true,
    target: 'continuous',
    conflictsWith: ['three-level', 'logic', 'blink', 'edge-toggle', 'calibration'],
    rules: [
      { kind: 'codeCalls', fn: 'analogWrite', where: 'loop' },
      { kind: 'onOffAndPwm' },
    ],
    tip: '밝기 = map(센서값, 최소, 최대, 0, 255); 켜야 할 때 analogWrite(ledPin, 밝기), 아니면 analogWrite(ledPin, 0).',
  },
  {
    id: 'edge-toggle',
    number: 5,
    title: '엣지 감지 토글',
    description: '{T}의 값이 바뀌는 순간(예: 버튼을 누르는 순간)에만 LED 상태를 반대로 바꾸세요.',
    minDifficulty: 3,
    target: 'digital',
    conflictsWith: ['onoff-pwm', 'blink', 'logic', 'three-level', 'two-leds'],
    rules: [{ kind: 'edgeToggle' }],
    tip: '이전 값을 저장하는 변수(lastValue)를 두고, 지금 값이 다르고 감지 상태일 때만 ledState = !ledState.',
  },
  {
    id: 'calibration',
    number: 6,
    title: '임계값 자동 보정',
    description: '시작할 때(setup) {T} 값을 읽어서 그 값을 기준으로 임계값을 자동으로 정하세요.',
    minDifficulty: 3,
    target: 'continuous',
    conflictsWith: ['three-level', 'onoff-pwm'],
    rules: [
      { kind: 'calibration' },
    ],
    tip: 'setup 에서 int baseValue = 센서읽기; threshold = baseValue + 100; 처럼 정하고 loop 에서 threshold 와 비교하세요.',
  },
  {
    id: 'logic',
    number: 7,
    title: 'AND / OR 조건',
    description: '두 센서 조건을 논리 연산으로 묶어 LED 를 제어하세요.',
    minDifficulty: 1,
    target: 'any',
    conflictsWith: ['onoff-pwm', 'two-leds', 'three-level', 'edge-toggle'],
    rules: [],
    variants: [
      {
        id: 'and',
        label: 'AND',
        description: '{A:와과} {B:이가} 모두 조건을 만족할 때만 LED 를 켜세요.',
        rules: [{ kind: 'logic', op: 'AND' }],
      },
      {
        id: 'or',
        label: 'OR',
        description: '{A:와과} {B} 중 하나라도 조건을 만족하면 LED 를 켜세요.',
        rules: [{ kind: 'logic', op: 'OR' }],
      },
    ],
    tip: 'AND 는 &&, OR 는 || 입니다. if (조건A && 조건B) { ... }',
  },
  {
    id: 'blink',
    number: 8,
    title: '조건 만족 시 깜빡임',
    description: '조건을 만족하면 LED 가 깜빡이고, 아니면 꺼져 있게 하세요.',
    minDifficulty: 2,
    target: 'any',
    conflictsWith: ['three-level', 'onoff-pwm', 'edge-toggle', 'two-leds'],
    rules: [{ kind: 'blinkWhenActive' }],
    tip: '조건이 참일 때 HIGH → delay(200) → LOW → delay(200) 를 실행하면 깜빡입니다.',
  },
  {
    id: 'two-leds',
    number: 9,
    title: 'LED 2개 관계',
    description: 'LED 2개를 사용하세요.',
    minDifficulty: 2,
    requiresLeds: 2,
    target: 'any',
    conflictsWith: ['logic', 'three-level', 'blink', 'edge-toggle'],
    rules: [],
    variants: [
      {
        id: 'independent',
        label: '독립 제어',
        description: 'LED1 은 {A}, LED2 는 {B:으로로} 각각 따로 제어하세요.',
        rules: [{ kind: 'twoLeds', mode: 'independent' }],
      },
      {
        id: 'opposite',
        label: '시소',
        description: '두 LED 가 항상 반대로 동작하게 하세요. (하나가 켜지면 다른 하나는 꺼짐)',
        rules: [{ kind: 'twoLeds', mode: 'opposite' }],
      },
    ],
    tip: '시소: digitalWrite(led1, state); digitalWrite(led2, !state); 처럼 반대 값을 쓰면 쉬워요.',
  },
]

export const CARD_MAP: Record<string, CardDef> = Object.fromEntries(CARDS.map((c) => [c.id, c]))
