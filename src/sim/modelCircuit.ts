import type { ArduinoPin, LedColor, SensorId } from '../types'
import { getSensor } from '../data/sensors'
import type { Circuit, CircuitPartKind, PlacedPart, Rot, Wire } from './parts'
import { SENSOR_PART } from './parts'
import { holeId } from './geometry'

// ─────────────────────────────────────────────────────────────
// 모범 배선 자동 생성
//   5V → 위 + 레일, GND → 위 − 레일, 위/아래 레일은 점퍼로 연결
//   센서 모듈(CDS 포함, VCC/GND/신호 3핀): a 열에 꽂고 c 열에서 선을 뺀다
//   LED: 220Ω 를 홈 위로 세로로 꽂고 LED 는 h 열
//   버튼(풀다운): 5V ─ 버튼 ─ 신호핀 ─ 10kΩ ─ GND
// ─────────────────────────────────────────────────────────────

export interface ModelSpec {
  sensors: SensorId[]
  pins: Partial<Record<SensorId, Record<string, ArduinoPin>>>
  leds: { pin: ArduinoPin; color: LedColor }[]
  buttonMode?: 'pulldown' | 'pullup'
}

const H = (c: number, y: number) => holeId(c, y)
const P = (pin: string) => `P:${pin}`

export const WIRE_COLORS = [
  { id: 'red', label: '빨강', hex: '#dc2626' },
  { id: 'black', label: '검정', hex: '#1f2937' },
  { id: 'orange', label: '주황', hex: '#ea580c' },
  { id: 'yellow', label: '노랑', hex: '#eab308' },
  { id: 'green', label: '초록', hex: '#16a34a' },
  { id: 'blue', label: '파랑', hex: '#2563eb' },
  { id: 'purple', label: '보라', hex: '#9333ea' },
  { id: 'white', label: '흰색', hex: '#e5e7eb' },
]
const SIGNAL_COLORS = ['orange', 'yellow', 'green', 'blue', 'purple', 'white']

export function buildModelCircuit(spec: ModelSpec): Circuit {
  const parts: PlacedPart[] = []
  const wires: Wire[] = []
  let n = 0
  let wn = 0
  let sig = 0
  const addPart = (kind: CircuitPartKind, col: number, y: number, rot: Rot = 0) => {
    const id = `m${++n}`
    parts.push({ id, kind, col, y, rot })
    return id
  }
  const wire = (a: string, b: string, color: string) => wires.push({ id: `w${++wn}`, a, b, color })
  const signalColor = () => SIGNAL_COLORS[sig++ % SIGNAL_COLORS.length]

  // 전원
  wire(P('5V'), H(1, 0), 'red')
  wire(P('GND2'), H(1, 1), 'black')
  wire(H(2, 0), H(2, 16), 'red')
  wire(H(2, 1), H(2, 17), 'black')

  let c = 4
  const modules = spec.sensors.filter((s) => s !== 'button')
  for (const id of modules) {
    const s = getSensor(id)
    addPart(SENSOR_PART[id], c, 3)
    s.modulePins.forEach((mp, i) => {
      const col = c + i
      if (mp.role === 'vcc') wire(H(col, 5), H(col, 0), 'red')
      else if (mp.role === 'gnd') wire(H(col, 5), H(col, 1), 'black')
      else {
        const signal = s.signals.find((g) => g.modulePin === mp.id)
        const pin = signal && spec.pins[id]?.[signal.key]
        if (signal && pin) wire(H(col, 5), P(pin), signalColor())
      }
    })
    c += s.modulePins.length + 1
  }

  if (spec.sensors.includes('button')) {
    const pin = spec.pins.button!.sig
    addPart('pushbutton', c, 7)
    if (spec.buttonMode === 'pullup') {
      wire(H(c, 4), P(pin), signalColor())
      wire(H(c + 2, 13), H(c + 2, 17), 'black')
      c += 4
    } else {
      wire(H(c, 4), H(c, 0), 'red')
      wire(H(c + 2, 13), P(pin), signalColor())
      addPart('res-10k', c + 2, 12, 3)
      wire(H(c + 6, 14), H(c + 6, 17), 'black')
      c += 8
    }
  }

  for (const led of spec.leds) {
    addPart('res-220', c, 7) // (c,7) ─ (c,11) 홈을 넘어 세로로
    addPart(`led-${led.color}` as CircuitPartKind, c, 12)
    wire(H(c, 4), P(led.pin), signalColor())
    wire(H(c + 1, 14), H(c + 1, 17), 'black')
    c += 3
  }

  return { parts, wires }
}
