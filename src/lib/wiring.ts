import type { Problem, SensorId } from '../types'
import { getSensor } from '../data/sensors'
import { pinLabel } from './problem'

export interface WiringRow { part: string; from: string; to: string; note?: string }

/** 배선 표 (부품 핀 → 아두이노 핀). 배선 가이드와 모범답안에서 함께 쓴다. */
export function wiringRows(p: Problem, id: SensorId): WiringRow[] {
  const s = getSensor(id)
  const pins = p.pins[id] ?? {}
  const name = s.shortName
  if (id === 'cds') {
    const a = pinLabel(pins.a0)
    return [
      { part: name, from: 'CDS 다리1', to: '5V' },
      { part: name, from: 'CDS 다리2', to: `${a} (분배점)`, note: 'CDS 와 10kΩ 이 만나는 열' },
      { part: '10kΩ', from: '한쪽', to: `${a} (분배점)` },
      { part: '10kΩ', from: '다른 쪽', to: 'GND' },
    ]
  }
  if (id === 'button') {
    const d = pinLabel(pins.sig)
    return p.buttonMode === 'pulldown'
      ? [
          { part: name, from: '한쪽 다리', to: '5V', note: '버튼은 중앙 홈을 가로질러 꽂기' },
          { part: name, from: '대각선 다리', to: d },
          { part: '10kΩ', from: `${d} 쪽 다리`, to: 'GND', note: '풀다운 저항' },
        ]
      : [
          { part: name, from: '한쪽 다리', to: d, note: 'INPUT_PULLUP, 저항 없음' },
          { part: name, from: '대각선 다리', to: 'GND' },
        ]
  }
  return s.modulePins.map((mp) => {
    if (mp.role === 'vcc') return { part: name, from: mp.label, to: '5V' }
    if (mp.role === 'gnd') return { part: name, from: mp.label, to: 'GND' }
    const sig = s.signals.find((x) => x.modulePin === mp.id)!
    const pin = pins[sig.key]
    return { part: name, from: mp.label, to: pin, note: sig.required ? undefined : '선택 (안 써도 됨)' }
  })
}

export function ledWiringRows(p: Problem): WiringRow[] {
  return p.leds.flatMap((l, i) => {
    const name = `LED${p.leds.length > 1 ? i + 1 : ''}`
    return [
      { part: name, from: '긴 다리(+)', to: `220Ω → ${l.pin}` },
      { part: name, from: '짧은 다리(−)', to: 'GND' },
    ]
  })
}
