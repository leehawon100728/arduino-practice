import { describe, expect, it } from 'vitest'
import { compileSource } from './compiler'
import { SimBoard, defaultValues } from '../sim/board'
import { buildModelCircuit } from '../sim/modelCircuit'
import { emptyCircuit, type Circuit } from '../sim/parts'
import { BASIC_TEMPLATES } from '../data/templates'

function run(src: string, opts: { circuit?: Circuit; ms?: number; values?: Record<string, number> } = {}) {
  const c = compileSource(src)
  if (!c.ok) throw new Error(`컴파일 실패: ${c.errors[0].line}: ${c.errors[0].message}`)
  const board = new SimBoard(opts.circuit ?? emptyCircuit(), { ...defaultValues(), ...opts.values })
  const r = c.createRunner!(board)
  board.now = () => r.ctx.time
  const status = r.run((opts.ms ?? 1000) * 1000, 2_000_000)
  return { board, r, status, serial: board.serialOut.map((s) => s.text).join('') }
}

const errOf = (src: string) => {
  const c = compileSource(src)
  expect(c.ok).toBe(false)
  return c.errors[0]
}

describe('해석기: 기본 동작', () => {
  it('Blink 템플릿: 13번 핀이 1초마다 바뀐다', () => {
    const { board } = run(BASIC_TEMPLATES[0].code, { ms: 4500 })
    const ev = board.events.filter((e) => e.pin === 13)
    expect(ev.map((e) => e.value)).toEqual([255, 0, 255, 0, 255])
    expect(Math.round((ev[1].t - ev[0].t) / 1000)).toBe(1000)
  })

  it('int 는 16비트, 정수 나눗셈은 버림', () => {
    const { serial } = run(`
      void setup() {
        Serial.begin(9600);
        int a = 32767; a = a + 1;
        Serial.println(a);
        Serial.println(7 / 2);
        Serial.println(7 / 2.0);
        long big = 100000; Serial.println(big * 3);
        float f = 3.14159; Serial.println(f, 3);
        Serial.println(-7 % 3);
        unsigned long m = 0; m = m - 1; Serial.println(m);
        char c = 'A'; Serial.println(c);
        Serial.println(255, HEX);
        bool b = 5; Serial.println(b);
        int d = 1000 * 0.034 / 2; Serial.println(d);
      }
      void loop() {}`)
    expect(serial.split('\r\n').slice(0, 11)).toEqual(['-32768', '3', '3.50', '300000', '3.142', '-1', '4294967295', 'A', 'FF', '1', '17'])
  })

  it('사용자 함수, 배열, for, while, switch, 참조 매개변수', () => {
    const { serial } = run(`
      int pins[] = {9, 10, 11};
      int sum(int a, int b) { return a + b; }
      void twice(int &x) { x = x * 2; }
      int fact(int n) { if (n <= 1) return 1; return n * fact(n - 1); }
      void setup() {
        Serial.begin(9600);
        int total = 0;
        for (int i = 0; i < 3; i++) total += pins[i];
        Serial.println(total);
        int k = 5; twice(k); Serial.println(k);
        Serial.println(sum(2, 3) * 2);
        Serial.println(fact(6));
        int n = 0; while (n < 10) { n++; if (n == 7) break; }
        Serial.println(n);
        switch (n) { case 7: Serial.println("seven"); break; default: Serial.println("other"); }
        String s = "거리: " + String(12) + " cm";
        Serial.println(s);
        Serial.println(sizeof(pins) / sizeof(pins[0]));
        Serial.println(map(512, 0, 1023, 0, 255));
        Serial.println(constrain(300, 0, 255));
      }
      void loop() {}`)
    expect(serial.split('\r\n').slice(0, 10)).toEqual(['30', '10', '10', '720', '7', 'seven', '거리: 12 cm', '3', '127', '255'])
  })

  it('#define 과 millis', () => {
    const { serial } = run(`
      #define LED 11
      #define WAIT 250
      unsigned long last = 0;
      void setup() { Serial.begin(9600); pinMode(LED, OUTPUT); }
      void loop() {
        if (millis() - last >= 1000) { last = millis(); Serial.println(last); }
        delay(WAIT);
      }`, { ms: 3200 })
    expect(serial.trim().split(/\r\n/).map(Number)).toEqual([1000, 2000, 3000])
  })

  it('Serial.begin 없이 출력하면 경고, 출력 없음', () => {
    const { board, serial } = run('void setup() { Serial.println("hi"); } void loop() {}')
    expect(serial).toBe('')
    expect([...board.warnings.values()].join()).toContain('Serial.begin')
  })

  it('무한 루프도 단계 제한으로 멈춘다', () => {
    const { status, r } = run('void setup() { while (true) { } } void loop() {}', { ms: 100000 })
    expect(status).toBe('running')
    expect(r.ctx.steps).toBeGreaterThan(1000)
  })

  it('런타임 오류: 0으로 나누기', () => {
    const { status, r } = run('int z = 0; void setup() { int a = 5 / z; } void loop() {}')
    expect(status).toBe('error')
    expect(r.error!.message).toContain('0으로')
    expect(r.error!.line).toBe(1)
  })
})

describe('해석기: 한국어 오류 메시지', () => {
  it('세미콜론', () => {
    const e = errOf('void setup() {\n  pinMode(11, OUTPUT)\n}\nvoid loop() {}')
    expect(e.line).toBe(2)
    expect(e.message).toContain('세미콜론(;)이 빠졌어요')
  })
  it('선언되지 않은 변수', () => {
    const e = errOf('void setup() {\n  pinMode(ledPin, OUTPUT);\n}\nvoid loop() {}')
    expect(e.line).toBe(2)
    expect(e.message).toBe('변수 ledPin이 선언되지 않았어요. 사용하기 전에 int ledPin = 0; 처럼 선언하세요.')
  })
  it('대소문자 실수 추천', () => {
    expect(errOf('void setup() { digitalwrite(11, HIGH); } void loop() {}').message).toContain('digitalWrite')
    expect(errOf('void setup() { Serial.Println(1); } void loop() {}').message).toContain('println')
    expect(errOf('void setup() { } void Loop() {}').message).toContain('loop() 함수가 없어요')
  })
  it('중괄호 짝', () => {
    expect(errOf('void setup() {\n  if (1) {\n}\nvoid loop() {}').message).toContain('닫히지 않았어요')
    expect(errOf('void setup() {}\n}\nvoid loop() {}').message).toContain('너무 많아요')
  })
  it('인자 개수 / 자료형', () => {
    expect(errOf('void setup() { digitalWrite(11); } void loop() {}').message).toContain('2개 필요')
    expect(errOf('void setup() { int x = "abc"; } void loop() {}').message).toContain('글자')
    expect(errOf('const int a = 1; void setup() { a = 2; } void loop() {}').message).toContain('바꿀 수 없어요')
    expect(errOf('void setup() { 한글 } void loop() {}').message).toContain('한글')
  })
  it('if 조건의 = 는 경고', () => {
    const c = compileSource('int x = 0; void setup() { if (x = 5) { } } void loop() {}')
    expect(c.ok).toBe(true)
    expect(c.warnings.map((w) => w.message).join()).toContain('==')
  })
})

describe('해석기 + 회로', () => {
  const spec = (s: Parameters<typeof buildModelCircuit>[0]) => buildModelCircuit(s)

  it('DHT11 템플릿 (DHT11.h) 이 온습도를 출력한다', () => {
    const circuit = spec({ sensors: ['dht11'], pins: { dht11: { data: 'D2' } }, leds: [] })
    const { serial } = run(BASIC_TEMPLATES[3].code, { circuit, ms: 1200, values: { 'dht11.temperature': 27, 'dht11.humidity': 61 } })
    expect(serial).toContain('Temperature: 27 °C\tHumidity: 61 %')
  })

  it('DHT11 이 연결 안 되면 오류 문자열', () => {
    const { serial } = run(BASIC_TEMPLATES[3].code, { ms: 600 })
    expect(serial).toContain('Error 253 Reading from DHT11 timed out.')
  })

  it('초음파 거리 측정과 LED', () => {
    const circuit = spec({ sensors: ['ultrasonic'], pins: { ultrasonic: { trig: 'D9', echo: 'D10' } }, leds: [{ pin: 'D11', color: 'red' }] })
    const code = `
      const int trigPin = 9; const int echoPin = 10; const int ledPin = 11;
      void setup() { Serial.begin(9600); pinMode(trigPin, OUTPUT); pinMode(echoPin, INPUT); pinMode(ledPin, OUTPUT); }
      void loop() {
        digitalWrite(trigPin, LOW); delayMicroseconds(2);
        digitalWrite(trigPin, HIGH); delayMicroseconds(10); digitalWrite(trigPin, LOW);
        long duration = pulseIn(echoPin, HIGH);
        int distance = duration * 0.034 / 2;
        Serial.println(distance);
        if (distance < 20) digitalWrite(ledPin, HIGH); else digitalWrite(ledPin, LOW);
        delay(100);
      }`
    const near = run(code, { circuit, ms: 500, values: { 'ultrasonic.distance': 12 } })
    expect(near.serial.split('\r\n')[0]).toBe('12')
    expect(near.board.snapshot().leds.m3.brightness).toBeGreaterThan(0.5)
    const far = run(code, { circuit, ms: 500, values: { 'ultrasonic.distance': 150 } })
    expect(Number(far.serial.split('\r\n')[0])).toBeGreaterThan(145)
    expect(far.board.snapshot().leds.m3.brightness).toBe(0)
  })

  it('CDS: 어두울수록 analogRead 값이 커진다', () => {
    const circuit = spec({ sensors: ['cds'], pins: { cds: { a0: 'A0' } }, leds: [] })
    const read = (light: number) => Number(run('void setup(){Serial.begin(9600);Serial.println(analogRead(A0));} void loop(){}', { circuit, values: { 'cds.light': light } }).serial.trim())
    const dark = read(0)
    const mid = read(50)
    const bright = read(100)
    expect(dark).toBeGreaterThan(900)
    expect(bright).toBeLessThan(150)
    expect(dark).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(bright)
  })

  it('버튼 풀다운: 누르면 HIGH, 풀업: 누르면 LOW', () => {
    const code = 'void setup(){Serial.begin(9600);pinMode(2, INPUT);} void loop(){Serial.println(digitalRead(2)); delay(1000);}'
    const pd = spec({ sensors: ['button'], pins: { button: { sig: 'D2' } }, leds: [], buttonMode: 'pulldown' })
    expect(run(code, { circuit: pd, values: { 'button.pressed': 0 } }).serial.trim()).toBe('0')
    expect(run(code, { circuit: pd, values: { 'button.pressed': 1 } }).serial.trim()).toBe('1')
    const pu = spec({ sensors: ['button'], pins: { button: { sig: 'D2' } }, leds: [], buttonMode: 'pullup' })
    const codeUp = code.replace('INPUT)', 'INPUT_PULLUP)')
    expect(run(codeUp, { circuit: pu, values: { 'button.pressed': 0 } }).serial.trim()).toBe('1')
    expect(run(codeUp, { circuit: pu, values: { 'button.pressed': 1 } }).serial.trim()).toBe('0')
  })

  it('LED 를 저항 없이 핀에 바로 꽂으면 터진다', () => {
    const circuit: Circuit = {
      parts: [{ id: 'L', kind: 'led-red', col: 5, y: 12, rot: 0 }],
      wires: [
        { id: 'a', a: 'P:D11', b: 'H:5:14', color: 'orange' },
        { id: 'b', a: 'P:GND1', b: 'H:6:14', color: 'black' },
      ],
    }
    const { board } = run('void setup(){pinMode(11,OUTPUT);digitalWrite(11,HIGH);} void loop(){}', { circuit })
    const snap = board.snapshot()
    expect(snap.leds.L.burnt).toBe(true)
    expect(snap.warnings.join()).toContain('터졌어요')
  })

  it('플로팅 입력 경고', () => {
    const { board } = run('void setup(){pinMode(2, INPUT);} void loop(){ int v = digitalRead(2); delay(10); }', { ms: 100 })
    expect([...board.warnings.values()].join()).toContain('플로팅')
  })
})
