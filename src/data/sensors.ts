import type { ArduinoPin, SensorDef, SensorId } from '../types'

// ─────────────────────────────────────────────────────────────
// 센서 7종 데이터
// - snippet 의 {{신호key}} 는 배정된 핀 번호로 바뀐다 (예: {{trig}} → 9, {{a0}} → A0)
// - {{activeLevel}} 은 감지 시 신호 레벨(HIGH/LOW)로 바뀐다 (IR, 버튼 풀업)
// - 새 센서를 추가하려면 이 배열에 항목을 추가하고 SensorId 타입에 id 를 넣는다.
// ─────────────────────────────────────────────────────────────

/** 기본 핀이 겹칠 때 쓰는 디지털 대체 핀 순서 (9,10,11 은 초음파/LED 용으로 뒤에 둔다) */
const DIGITAL_FALLBACK: ArduinoPin[] = ['D2', 'D3', 'D4', 'D7', 'D8', 'D12', 'D13', 'D5', 'D6']
const ANALOG_FALLBACK: ArduinoPin[] = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']

const without = (list: ArduinoPin[], pin: ArduinoPin) => list.filter((p) => p !== pin)

export const SENSORS: SensorDef[] = [
  // ── PIR ───────────────────────────────────────────────────
  {
    id: 'pir',
    name: 'PIR 동작감지 센서',
    shortName: 'PIR',
    model: 'HC-SR501',
    icon: '🚶',
    summary: '사람의 움직임(적외선 변화)을 감지하면 OUT 핀이 HIGH 가 됩니다.',
    modulePins: [
      { id: 'vcc', label: 'VCC', role: 'vcc' },
      { id: 'out', label: 'OUT', role: 'signal' },
      { id: 'gnd', label: 'GND', role: 'gnd' },
    ],
    signals: [
      {
        key: 'out', label: 'OUT', modulePin: 'out', direction: 'input', pinType: 'digital',
        defaultPin: 'D2', altPins: without(DIGITAL_FALLBACK, 'D2'), required: true,
        allowedModes: ['INPUT'],
      },
    ],
    extraParts: [],
    readMethods: ['digitalRead'],
    continuous: false,
    controls: [
      { key: 'motion', label: '움직임', type: 'toggle', default: 0, onLabel: '감지됨', offLabel: '없음', testValues: [0, 1] },
    ],
    sensibleRange: { min: 0, max: 1, unit: '' },
    snippet: {
      includes: [],
      globals: 'const int pirPin = {{out}};   // PIR 센서 OUT 핀\nint pirValue = 0;          // PIR 값 (감지: HIGH)',
      setup: 'pinMode(pirPin, INPUT);     // PIR 센서는 입력',
      read: 'pirValue = digitalRead(pirPin);   // 움직임이 있으면 HIGH',
      valueVars: [{ name: 'pirValue', label: 'PIR', unit: '' }],
      condition: { expr: 'pirValue == HIGH', desc: '움직임이 감지되면' },
      loopDelayMs: 100,
    },
    alternatives: [],
    notes: [
      '주황색 나사 2개: 왼쪽(Tx)은 감지 후 HIGH 유지 시간(약 3초~5분), 오른쪽(Sx)은 감도(감지 거리 약 3~7m)입니다.',
      '점퍼 H(반복 트리거): 움직임이 계속되면 HIGH 를 계속 유지. L(단일 트리거): 유지 시간이 끝나면 한 번 LOW 로 떨어집니다.',
      '전원을 넣고 약 30초~1분은 안정화 시간이라 값이 튈 수 있습니다.',
      '열(적외선)의 "변화"를 감지하므로 가만히 있는 사람/물체는 감지하지 못합니다.',
    ],
    mistakes: [
      'VCC 와 GND 를 반대로 꽂음 (모듈 뒷면 라벨을 꼭 확인)',
      'pinMode(pirPin, OUTPUT) 으로 잘못 설정',
      '감지 후 바로 꺼지지 않는다고 코드 문제로 착각 (유지 시간 나사 때문)',
    ],
    examPitfalls: [
      '돔(흰 렌즈)을 벗기면 핀 라벨이 보입니다. 핀 순서는 모듈마다 다를 수 있어요.',
      'HIGH 유지 시간 때문에 LED 가 몇 초간 계속 켜져 있는 것은 정상입니다.',
    ],
    hints: [
      'PIR 은 움직임이 있으면 HIGH, 없으면 LOW 를 내보내는 디지털 센서예요. digitalRead 로 읽으면 됩니다.',
      'setup: pinMode(PIR핀, INPUT)\nloop: 값 = digitalRead(PIR핀)\n      만약 값 == HIGH 이면 LED 켜기, 아니면 끄기',
      'int pirValue = digitalRead(pirPin);\nif (pirValue == HIGH) {\n  digitalWrite(ledPin, HIGH);\n} else {\n  digitalWrite(ledPin, LOW);\n}',
    ],
  },

  // ── DHT11 ─────────────────────────────────────────────────
  {
    id: 'dht11',
    name: '온습도 센서',
    shortName: 'DHT11',
    model: 'DHT11 모듈',
    icon: '🌡️',
    summary: '온도(°C)와 습도(%)를 한 개의 DATA 선으로 보내 주는 디지털 센서입니다. 라이브러리로 읽습니다.',
    modulePins: [
      { id: 'vcc', label: 'VCC', role: 'vcc' },
      { id: 'data', label: 'DATA', role: 'signal' },
      { id: 'gnd', label: 'GND', role: 'gnd' },
    ],
    signals: [
      {
        key: 'data', label: 'DATA', modulePin: 'data', direction: 'input', pinType: 'digital',
        defaultPin: 'D2', altPins: without(DIGITAL_FALLBACK, 'D2'), required: true,
        allowedModes: [], // 라이브러리가 알아서 설정
      },
    ],
    extraParts: [],
    readMethods: ['dht'],
    continuous: true,
    controls: [
      { key: 'temperature', label: '온도', type: 'slider', min: 0, max: 50, step: 1, unit: '°C', default: 24, testValues: [5, 15, 20, 24, 27, 30, 35, 45] },
      { key: 'humidity', label: '습도', type: 'slider', min: 20, max: 90, step: 1, unit: '%', default: 50, testValues: [20, 35, 50, 60, 70, 85] },
    ],
    sensibleRange: { min: 0, max: 90, unit: '°C / %' },
    snippet: {
      includes: ['#include <DHT11.h>'],
      globals: 'DHT11 dht11({{data}});   // DHT11 DATA 핀\nint temperature = 0;     // 온도 (°C)\nint humidity = 0;        // 습도 (%)',
      setup: '',
      read: 'int result = dht11.readTemperatureHumidity(temperature, humidity);   // 0 이면 읽기 성공',
      valueVars: [
        { name: 'temperature', label: '온도', unit: '°C' },
        { name: 'humidity', label: '습도', unit: '%' },
      ],
      condition: { expr: 'temperature >= 28', desc: '온도가 28°C 이상이면' },
      loopDelayMs: 2000,
    },
    alternatives: [
      {
        title: 'DHT.h 라이브러리 방식',
        description: 'Adafruit DHT 라이브러리. dht.begin() 이 꼭 필요하고 float 값을 돌려줍니다.',
        snippet: {
          includes: ['#include <DHT.h>'],
          globals: 'DHT dht({{data}}, DHT11);   // (핀, 센서 종류)\nfloat temperature = 0;     // 온도 (°C)\nfloat humidity = 0;        // 습도 (%)',
          setup: 'dht.begin();   // DHT 센서 시작',
          read: 'temperature = dht.readTemperature();   // 온도 읽기\nhumidity = dht.readHumidity();         // 습도 읽기',
          valueVars: [
            { name: 'temperature', label: '온도', unit: '°C' },
            { name: 'humidity', label: '습도', unit: '%' },
          ],
          condition: { expr: 'temperature >= 28', desc: '온도가 28°C 이상이면' },
          loopDelayMs: 2000,
        },
      },
    ],
    notes: [
      'DHT11 은 1~2초에 한 번만 측정할 수 있어요. loop 끝에 delay(2000) 을 넣으세요.',
      '측정 범위: 온도 0~50°C(±2°C), 습도 20~90%(±5%).',
      'DHT11.h 방식은 readTemperatureHumidity(온도, 습도) 가 0 을 돌려주면 성공입니다.',
      '3핀 모듈은 풀업 저항이 이미 들어 있어서 저항을 따로 달 필요가 없어요.',
    ],
    mistakes: [
      'delay 없이 너무 자주 읽어서 오류 값이 나옴',
      '#include <DHT11.h> 를 빼먹거나 DHT.h 방식과 섞어 씀',
      'DHT.h 방식에서 dht.begin() 을 빠뜨림',
    ],
    examPitfalls: [
      '라이브러리 이름(DHT11.h vs DHT.h)에 따라 함수가 완전히 다릅니다. 한 가지만 쓰세요.',
      'result 가 0 이 아닐 때(오류)도 LED 가 이상하게 동작하지 않게 처리하면 좋아요.',
    ],
    hints: [
      'DHT11 은 라이브러리로 온도·습도를 한 번에 읽어요. 읽은 온도로 조건을 만들면 됩니다.',
      '전역: DHT11 dht11(핀번호);\nloop: result = dht11.readTemperatureHumidity(온도, 습도)\n      만약 온도 >= 기준 이면 LED 켜기\n      delay(2000)',
      'int temperature = 0;\nint humidity = 0;\nint result = dht11.readTemperatureHumidity(temperature, humidity);\nif (result == 0 && temperature >= 28) {\n  digitalWrite(ledPin, HIGH);\n} else {\n  digitalWrite(ledPin, LOW);\n}\ndelay(2000);',
    ],
  },

  // ── 초음파 ────────────────────────────────────────────────
  {
    id: 'ultrasonic',
    name: '초음파 거리 센서',
    shortName: '초음파',
    model: 'HC-SR04',
    icon: '📏',
    summary: 'Trig 로 초음파를 쏘고 Echo 로 돌아오는 시간을 재서 거리(cm)를 계산합니다.',
    modulePins: [
      { id: 'vcc', label: 'VCC', role: 'vcc' },
      { id: 'trig', label: 'Trig', role: 'signal' },
      { id: 'echo', label: 'Echo', role: 'signal' },
      { id: 'gnd', label: 'GND', role: 'gnd' },
    ],
    signals: [
      {
        key: 'trig', label: 'Trig', modulePin: 'trig', direction: 'output', pinType: 'digital',
        defaultPin: 'D9', altPins: ['D7', 'D8', 'D12', 'D4', 'D5', 'D6'], required: true,
        allowedModes: ['OUTPUT'],
      },
      {
        key: 'echo', label: 'Echo', modulePin: 'echo', direction: 'input', pinType: 'digital',
        defaultPin: 'D10', altPins: ['D8', 'D12', 'D13', 'D7', 'D4', 'D5'], required: true,
        allowedModes: ['INPUT'],
      },
    ],
    extraParts: [],
    readMethods: ['pulseIn'],
    continuous: true,
    controls: [
      { key: 'distance', label: '거리', type: 'slider', min: 2, max: 400, step: 1, unit: 'cm', default: 100, testValues: [3, 8, 15, 25, 40, 70, 120, 250, 390] },
    ],
    sensibleRange: { min: 2, max: 400, unit: 'cm' },
    snippet: {
      includes: [],
      globals: 'const int trigPin = {{trig}};   // 초음파 Trig 핀\nconst int echoPin = {{echo}};   // 초음파 Echo 핀\nlong duration = 0;            // 초음파가 돌아온 시간 (µs)\nint distance = 0;             // 거리 (cm)',
      setup: 'pinMode(trigPin, OUTPUT);   // Trig 는 출력\npinMode(echoPin, INPUT);    // Echo 는 입력',
      read:
        'digitalWrite(trigPin, LOW);    // 깨끗하게 LOW 로 시작\ndelayMicroseconds(2);\ndigitalWrite(trigPin, HIGH);   // 10µs 동안 초음파 발사\ndelayMicroseconds(10);\ndigitalWrite(trigPin, LOW);\nduration = pulseIn(echoPin, HIGH);   // 돌아오는 데 걸린 시간\ndistance = duration * 0.034 / 2;     // 시간 → 거리(cm)',
      valueVars: [{ name: 'distance', label: '거리', unit: 'cm' }],
      condition: { expr: 'distance < 20', desc: '20cm 보다 가까우면' },
      loopDelayMs: 100,
    },
    alternatives: [],
    notes: [
      '측정 범위는 약 2cm ~ 400cm 입니다.',
      '소리는 1µs 에 약 0.034cm 이동해요. 왕복 시간이므로 2 로 나눕니다.',
      'Trig: LOW 2µs → HIGH 10µs → LOW 순서로 신호를 줍니다.',
    ],
    mistakes: [
      'Trig 와 Echo 핀을 바꿔 꽂거나 코드의 핀 번호와 다르게 꽂음',
      '÷2 를 빼먹어 거리가 두 배로 나옴',
      'pinMode 를 둘 다 INPUT 또는 OUTPUT 으로 설정',
    ],
    examPitfalls: [
      'duration 은 큰 값이라 long 으로 선언하는 것이 안전합니다.',
      '거리 임계값을 400 이상 또는 0 이하로 정하면 LED 가 절대 바뀌지 않아요.',
    ],
    hints: [
      '초음파는 "시간"을 재서 거리로 바꿔요. 쏘기(Trig) → 받기(Echo, pulseIn) → 계산 순서입니다.',
      'setup: Trig=OUTPUT, Echo=INPUT\nloop: Trig LOW→HIGH(10µs)→LOW\n      시간 = pulseIn(Echo, HIGH)\n      거리 = 시간 * 0.034 / 2\n      만약 거리 < 기준 이면 LED 켜기',
      'digitalWrite(trigPin, LOW);\ndelayMicroseconds(2);\ndigitalWrite(trigPin, HIGH);\ndelayMicroseconds(10);\ndigitalWrite(trigPin, LOW);\nlong duration = pulseIn(echoPin, HIGH);\nint distance = duration * 0.034 / 2;\nif (distance < 20) { digitalWrite(ledPin, HIGH); } else { digitalWrite(ledPin, LOW); }',
    ],
  },

  // ── 푸시버튼 ──────────────────────────────────────────────
  {
    id: 'button',
    name: '푸시버튼',
    shortName: '버튼',
    model: '4핀 택트 스위치',
    icon: '🔘',
    summary: '누르면 회로가 연결되는 스위치입니다. 풀다운 저항(누르면 HIGH) 또는 내부 풀업(누르면 LOW)으로 씁니다.',
    modulePins: [
      { id: 'a1', label: '1', role: 'passive' },
      { id: 'a2', label: '2', role: 'passive' },
      { id: 'b1', label: '3', role: 'passive' },
      { id: 'b2', label: '4', role: 'passive' },
    ],
    signals: [
      {
        key: 'sig', label: '버튼 신호', modulePin: null, direction: 'input', pinType: 'digital',
        defaultPin: 'D2', altPins: without(DIGITAL_FALLBACK, 'D2'), required: true,
        allowedModes: ['INPUT', 'INPUT_PULLUP'],
      },
    ],
    extraParts: [{ part: 'res-10k', note: '풀다운 방식일 때 신호 핀 ↔ GND 사이 10kΩ' }],
    readMethods: ['digitalRead'],
    continuous: false,
    controls: [
      { key: 'pressed', label: '버튼', type: 'momentary', default: 0, onLabel: '누름', offLabel: '뗌', testValues: [0, 1] },
    ],
    sensibleRange: { min: 0, max: 1, unit: '' },
    snippet: {
      includes: [],
      globals: 'const int buttonPin = {{sig}};   // 버튼 신호 핀\nint buttonValue = 0;           // 버튼 값',
      setup: 'pinMode(buttonPin, INPUT);   // 10kΩ 풀다운 저항 사용',
      read: 'buttonValue = digitalRead(buttonPin);   // 누르면 HIGH',
      valueVars: [{ name: 'buttonValue', label: '버튼', unit: '' }],
      condition: { expr: 'buttonValue == HIGH', desc: '버튼을 누르면' },
      loopDelayMs: 50,
    },
    alternatives: [
      {
        title: '내부 풀업(INPUT_PULLUP) 방식',
        description: '저항 없이 버튼 한쪽은 신호 핀, 다른 쪽은 GND 에 연결. 누르면 LOW 가 됩니다.',
        snippet: {
          includes: [],
          globals: 'const int buttonPin = {{sig}};   // 버튼 신호 핀\nint buttonValue = 0;           // 버튼 값',
          setup: 'pinMode(buttonPin, INPUT_PULLUP);   // 내부 풀업 (저항 필요 없음)',
          read: 'buttonValue = digitalRead(buttonPin);   // 누르면 LOW (거꾸로!)',
          valueVars: [{ name: 'buttonValue', label: '버튼', unit: '' }],
          condition: { expr: 'buttonValue == LOW', desc: '버튼을 누르면' },
          loopDelayMs: 50,
        },
      },
    ],
    notes: [
      '4핀 버튼은 마주 보는 두 쌍이 내부에서 항상 연결되어 있어요. 브레드보드 중앙 홈을 가로질러 꽂아야 위/아래가 분리됩니다.',
      '풀다운: 5V ─ 버튼 ─ 신호핀, 신호핀 ─ 10kΩ ─ GND. 누르면 HIGH.',
      '내부 풀업: 신호핀 ─ 버튼 ─ GND, pinMode(핀, INPUT_PULLUP). 누르면 LOW.',
      '저항 없이 INPUT 으로만 쓰면 값이 둥둥 떠서(플로팅) 제멋대로 바뀝니다.',
    ],
    mistakes: [
      '버튼을 홈을 넘기지 않고 한쪽에만 꽂아 항상 눌린 상태가 됨',
      '풀다운 저항 없이 INPUT 사용 → 값이 랜덤하게 바뀜',
      'INPUT_PULLUP 인데 누르면 HIGH 라고 생각해 조건을 반대로 씀',
    ],
    examPitfalls: [
      '버튼 대각선 다리를 쓰면 방향과 상관없이 안전하게 연결됩니다.',
      'INPUT_PULLUP 이면 조건이 == LOW 입니다.',
    ],
    hints: [
      '버튼은 누름/뗌 두 상태를 digitalRead 로 읽어요. 저항 연결 방식에 따라 누를 때 HIGH 또는 LOW 입니다.',
      'setup: pinMode(버튼핀, INPUT) 또는 INPUT_PULLUP\nloop: 값 = digitalRead(버튼핀)\n      눌렸으면 LED 켜기, 아니면 끄기',
      'int buttonValue = digitalRead(buttonPin);\nif (buttonValue == HIGH) {   // INPUT_PULLUP 이면 LOW\n  digitalWrite(ledPin, HIGH);\n} else {\n  digitalWrite(ledPin, LOW);\n}',
    ],
  },

  // ── 조도(CDS) ─────────────────────────────────────────────
  {
    id: 'cds',
    name: '조도 센서',
    shortName: 'CDS',
    model: 'CDS 광센서 + 10kΩ',
    icon: '💡',
    summary: '빛의 양에 따라 저항이 바뀌는 센서입니다. 10kΩ 과 전압 분배 회로를 만들어 analogRead 로 읽습니다.',
    modulePins: [
      { id: 'l1', label: '다리1', role: 'passive' },
      { id: 'l2', label: '다리2', role: 'passive' },
    ],
    signals: [
      {
        key: 'a0', label: '분배점', modulePin: null, direction: 'input', pinType: 'analog',
        defaultPin: 'A0', altPins: without(ANALOG_FALLBACK, 'A0'), required: true,
        allowedModes: [],
      },
    ],
    extraParts: [{ part: 'res-10k', note: '전압 분배용 10kΩ' }],
    readMethods: ['analogRead'],
    continuous: true,
    controls: [
      { key: 'light', label: '주변 밝기', type: 'slider', min: 0, max: 100, step: 1, unit: '%', default: 60, testValues: [0, 10, 25, 40, 50, 60, 75, 90, 100] },
    ],
    sensibleRange: { min: 0, max: 1023, unit: '' },
    snippet: {
      includes: [],
      globals: 'const int cdsPin = {{a0}};   // 조도 센서 아날로그 핀\nint cdsValue = 0;          // 조도 값 (0~1023)',
      setup: '',
      read: 'cdsValue = analogRead(cdsPin);   // 어두울수록 큰 값',
      valueVars: [{ name: 'cdsValue', label: '밝기', unit: '' }],
      condition: { expr: 'cdsValue > 500', desc: '어두우면 (값이 500 보다 크면)' },
      loopDelayMs: 100,
    },
    alternatives: [],
    notes: [
      'CDS 는 밝으면 저항이 작아지고 어두우면 커집니다.',
      '수업 슬라이드 회로 기준으로 어두울수록 analogRead 값이 커지게 연결합니다.',
      'analogRead 는 0~1023 입니다. analogWrite(0~255) 와 범위가 달라요!',
      '방마다 밝기가 다르니 임계값은 시리얼 모니터로 실제 값을 보고 정하세요.',
    ],
    mistakes: [
      '10kΩ 저항 없이 CDS 만 연결 → 값이 거의 변하지 않음',
      'A0 대신 디지털 핀에 연결하고 analogRead 사용',
      '임계값을 1023 보다 크게 잡아 조건이 절대 참이 안 됨',
    ],
    examPitfalls: [
      '분배점(CDS 와 저항이 만나는 열)에 A0 를 연결해야 합니다.',
      '밝을 때/어두울 때 값이 어느 쪽으로 커지는지 먼저 시리얼로 확인하세요.',
    ],
    hints: [
      'CDS 와 10kΩ 으로 전압을 나누고, 그 중간 전압을 analogRead 로 읽어요. 값은 0~1023 입니다.',
      'loop: 값 = analogRead(A0)\n      만약 값 > 기준 이면 (어두우면) LED 켜기\n      아니면 끄기',
      'int cdsValue = analogRead(cdsPin);\nif (cdsValue > 500) {\n  digitalWrite(ledPin, HIGH);\n} else {\n  digitalWrite(ledPin, LOW);\n}',
    ],
  },

  // ── 라인센서 ──────────────────────────────────────────────
  {
    id: 'line',
    name: '라인 센서',
    shortName: '라인',
    model: 'TCRT5000',
    icon: '〰️',
    summary: '적외선을 쏘고 반사를 읽습니다. 흰색/물체(반사)면 D0 가 LOW, 검은색이면 HIGH 입니다.',
    modulePins: [
      { id: 'vcc', label: 'VCC', role: 'vcc' },
      { id: 'gnd', label: 'GND', role: 'gnd' },
      { id: 'd0', label: 'D0', role: 'signal' },
      { id: 'a0', label: 'A0', role: 'signal' },
    ],
    signals: [
      {
        key: 'd0', label: 'D0 (디지털)', modulePin: 'd0', direction: 'input', pinType: 'digital',
        defaultPin: 'D3', altPins: without(DIGITAL_FALLBACK, 'D3'), required: true,
        allowedModes: ['INPUT'],
      },
      {
        key: 'a0', label: 'A0 (아날로그)', modulePin: 'a0', direction: 'input', pinType: 'analog',
        defaultPin: 'A0', altPins: without(ANALOG_FALLBACK, 'A0'), required: false,
        allowedModes: [],
      },
    ],
    extraParts: [],
    readMethods: ['digitalRead', 'analogRead'],
    continuous: false,
    controls: [
      { key: 'white', label: '바닥', type: 'toggle', default: 0, onLabel: '흰색(반사)', offLabel: '검은색', testValues: [0, 1] },
    ],
    sensibleRange: { min: 0, max: 1023, unit: '' },
    snippet: {
      includes: [],
      globals: 'const int linePin = {{d0}};   // 라인센서 D0 핀\nint lineValue = 0;          // 라인센서 값',
      setup: 'pinMode(linePin, INPUT);     // 라인센서는 입력',
      read: 'lineValue = digitalRead(linePin);   // 흰색(반사)이면 LOW',
      valueVars: [{ name: 'lineValue', label: '라인', unit: '' }],
      condition: { expr: 'lineValue == LOW', desc: '흰색(반사)을 감지하면' },
      loopDelayMs: 100,
    },
    alternatives: [
      {
        title: '아날로그(A0) 방식',
        description: '반사 정도를 0~1023 으로 읽고 map() 으로 LED 밝기(0~255)로 바꿀 수 있어요.',
        snippet: {
          includes: [],
          globals: 'const int lineAPin = {{a0}};   // 라인센서 A0 핀\nint lineValue = 0;           // 반사 값 (0~1023, 반사가 강하면 작음)',
          setup: '',
          read: 'lineValue = analogRead(lineAPin);   // 흰색이면 작은 값',
          valueVars: [{ name: 'lineValue', label: '라인', unit: '' }],
          condition: { expr: 'lineValue < 500', desc: '흰색(반사)을 감지하면' },
          loopDelayMs: 100,
        },
      },
    ],
    notes: [
      '파란 가변저항(나사)으로 D0 가 바뀌는 기준(감도)을 조절합니다.',
      '디지털 출력은 반사가 있을 때(흰색/물체) LOW 입니다. 헷갈리기 쉬워요!',
      '센서와 바닥 사이 거리는 약 1~2cm 가 적당합니다.',
    ],
    mistakes: [
      '흰색일 때 HIGH 라고 생각해 조건을 반대로 씀',
      'D0 와 A0 핀을 바꿔 연결',
      'analogRead 값을 그대로 analogWrite 에 넣음 (map 필요)',
    ],
    examPitfalls: [
      '모듈의 LED(D0 표시등)가 켜질 때가 LOW 입니다.',
      '아날로그 값을 LED 밝기로 쓸 땐 map(값, 0, 1023, 0, 255).',
    ],
    hints: [
      '라인센서 D0 는 디지털 센서예요. 흰색(반사)이면 LOW, 검은색이면 HIGH 입니다.',
      'setup: pinMode(라인핀, INPUT)\nloop: 값 = digitalRead(라인핀)\n      만약 값 == LOW (흰색) 이면 LED 켜기',
      'int lineValue = digitalRead(linePin);\nif (lineValue == LOW) {\n  digitalWrite(ledPin, HIGH);\n} else {\n  digitalWrite(ledPin, LOW);\n}',
    ],
  },

  // ── 적외선 장애물 센서 ─────────────────────────────────────
  {
    id: 'ir',
    name: '적외선 장애물 센서',
    shortName: 'IR',
    model: 'IR 장애물 감지 모듈',
    icon: '🚧',
    summary: '앞에 장애물이 있으면 OUT 신호가 바뀝니다. 대부분의 모듈은 감지 시 LOW 입니다.',
    modulePins: [
      { id: 'vcc', label: 'VCC', role: 'vcc' },
      { id: 'gnd', label: 'GND', role: 'gnd' },
      { id: 'out', label: 'OUT', role: 'signal' },
    ],
    signals: [
      {
        key: 'out', label: 'OUT', modulePin: 'out', direction: 'input', pinType: 'digital',
        defaultPin: 'D4', altPins: without(DIGITAL_FALLBACK, 'D4'), required: true,
        allowedModes: ['INPUT'],
      },
    ],
    extraParts: [],
    readMethods: ['digitalRead'],
    continuous: false,
    controls: [
      { key: 'obstacle', label: '장애물', type: 'toggle', default: 0, onLabel: '있음', offLabel: '없음', testValues: [0, 1] },
    ],
    sensibleRange: { min: 0, max: 1, unit: '' },
    snippet: {
      includes: [],
      globals: 'const int irPin = {{out}};   // IR 센서 OUT 핀\nint irValue = 0;           // IR 값',
      setup: 'pinMode(irPin, INPUT);     // IR 센서는 입력',
      read: 'irValue = digitalRead(irPin);   // 장애물이 있으면 {{activeLevel}}',
      valueVars: [{ name: 'irValue', label: 'IR', unit: '' }],
      condition: { expr: 'irValue == {{activeLevel}}', desc: '장애물이 감지되면' },
      loopDelayMs: 100,
    },
    alternatives: [],
    notes: [
      '흔한 모듈은 장애물 감지 시 LOW, 없으면 HIGH 입니다. 문제에 적힌 극성을 꼭 확인하세요.',
      '파란 가변저항으로 감지 거리(약 2~30cm)를 조절합니다.',
      '검은색 물체는 적외선을 흡수해서 잘 감지되지 않을 수 있어요.',
    ],
    mistakes: [
      '감지 시 HIGH 라고 착각해 조건을 반대로 씀',
      '라인센서와 헷갈려 analogRead 로 읽음',
      'VCC/GND 핀 순서를 확인하지 않고 꽂음',
    ],
    examPitfalls: [
      '모듈의 감지 LED 가 켜지는지 먼저 확인하면 배선 문제인지 코드 문제인지 구분할 수 있어요.',
    ],
    hints: [
      'IR 장애물 센서는 디지털 센서예요. 장애물이 있을 때 값이 LOW(또는 HIGH)로 바뀝니다.',
      'setup: pinMode(IR핀, INPUT)\nloop: 값 = digitalRead(IR핀)\n      만약 값 == 감지레벨 이면 LED 켜기',
      'int irValue = digitalRead(irPin);\nif (irValue == LOW) {   // 감지 시 LOW 모듈 기준\n  digitalWrite(ledPin, HIGH);\n} else {\n  digitalWrite(ledPin, LOW);\n}',
    ],
  },
]

export const SENSOR_MAP: Record<SensorId, SensorDef> = Object.fromEntries(
  SENSORS.map((s) => [s.id, s]),
) as Record<SensorId, SensorDef>

export const SENSOR_IDS: SensorId[] = SENSORS.map((s) => s.id)

export function getSensor(id: SensorId): SensorDef {
  return SENSOR_MAP[id]
}

/** PWM(~) 가능한 UNO 디지털 핀 */
export const PWM_PINS = ['D3', 'D5', 'D6', 'D9', 'D10', 'D11'] as const

/** 공통 경고 문구 (모든 실습 화면에 노출) */
export const COMMON_WARNINGS = [
  'LED 긴 다리(+) → 220Ω → 디지털 핀, 짧은 다리(−) → GND',
  'PWM(analogWrite)은 ~ 표시 핀(3, 5, 6, 9, 10, 11)에서만 됩니다.',
  'D0, D1 은 시리얼 통신용이라 쓰지 않아요.',
  'analogRead 는 0~1023, analogWrite 는 0~255 입니다.',
]
