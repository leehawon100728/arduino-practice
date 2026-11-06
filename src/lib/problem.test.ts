import { describe, expect, it } from 'vitest'
import type { ArduinoPin, Difficulty } from '../types'
import { SENSORS } from '../data/sensors'
import { CARDS, CARD_MAP } from '../data/cards'
import { ALL_COMBOS, generateProblem, problemKey } from './problem'
import { parsePracticeParams, practiceUrl } from './route'

function allPins(p: ReturnType<typeof generateProblem>): ArduinoPin[] {
  return [...Object.values(p.pins).flatMap((m) => Object.values(m!)), ...p.leds.map((l) => l.pin)]
}

describe('데이터 스키마', () => {
  it('센서 7종, 카드 9장', () => {
    expect(SENSORS).toHaveLength(7)
    expect(CARDS).toHaveLength(9)
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(9)
  })
  it('스펙 표의 기본 핀', () => {
    const def = Object.fromEntries(SENSORS.map((s) => [s.id, Object.fromEntries(s.signals.map((g) => [g.key, g.defaultPin]))]))
    expect(def.pir).toEqual({ out: 'D2' })
    expect(def.dht11).toEqual({ data: 'D2' })
    expect(def.ultrasonic).toEqual({ trig: 'D9', echo: 'D10' })
    expect(def.button).toEqual({ sig: 'D2' })
    expect(def.cds).toEqual({ a0: 'A0' })
    expect(def.line).toEqual({ d0: 'D3', a0: 'A0' })
    expect(def.ir).toEqual({ out: 'D4' })
  })
  it('모든 스니펫 플레이스홀더가 신호 key 와 일치', () => {
    for (const s of SENSORS) {
      const keys = new Set([...s.signals.map((g) => g.key), 'activeLevel'])
      const snippets = [s.snippet, ...s.alternatives.map((a) => a.snippet)]
      for (const sn of snippets) {
        const text = [sn.globals, sn.setup, sn.read, sn.condition.expr].join('\n')
        for (const m of text.matchAll(/\{\{(\w+)\}\}/g)) expect(keys, `${s.id}: {{${m[1]}}}`).toContain(m[1])
      }
    }
  })
  it('카드 충돌 목록이 실제 카드 id 를 가리킨다', () => {
    for (const c of CARDS) for (const x of c.conflictsWith) expect(CARD_MAP[x], `${c.id} → ${x}`).toBeDefined()
  })
})

describe('문제 생성', () => {
  it('조합은 21개이고 중복이 없다', () => {
    expect(ALL_COMBOS).toHaveLength(21)
    expect(new Set(ALL_COMBOS.map((c) => c.join('+'))).size).toBe(21)
  })

  for (const lv of [1, 2, 3] as Difficulty[]) {
    it(`Lv${lv}: 21개 조합 × 여러 시드에서 핀 충돌 없음, D0/D1 미사용`, () => {
      for (const combo of ALL_COMBOS) {
        for (let seed = 1; seed <= 40; seed++) {
          for (const mode of ['combo', 'exam'] as const) {
            const p = generateProblem({ mode, sensors: [...combo], difficulty: lv, seed })
            const pins = allPins(p)
            expect(new Set(pins).size, `${p.key}: ${pins.join(',')}`).toBe(pins.length)
            expect(pins).not.toContain('D0' as ArduinoPin)
            expect(pins).not.toContain('D1' as ArduinoPin)
            // 카드 충돌 없음 + 대상 센서 조건
            for (const c of p.cards) {
              const def = CARD_MAP[c.cardId]
              for (const o of p.cards) expect(def.conflictsWith).not.toContain(o.cardId)
              if (def.requiresLeds) expect(p.leds.length).toBeGreaterThanOrEqual(def.requiresLeds)
              if (def.requiresPwmLed) for (const l of p.leds) expect(['D3', 'D5', 'D6', 'D9', 'D10', 'D11']).toContain(l.pin)
              if (def.target === 'continuous') expect(SENSORS.find((s) => s.id === c.target)!.continuous).toBe(true)
              if (def.variants) expect(def.variants.map((v) => v.id)).toContain(c.variantId)
            }
            const [lo, hi] = mode === 'exam' ? (lv === 3 ? [1, 2] : [0, 2]) : lv === 1 ? [0, 0] : lv === 2 ? [0, 1] : [1, 2]
            expect(p.cards.length).toBeGreaterThanOrEqual(lo)
            expect(p.cards.length).toBeLessThanOrEqual(hi)
            if (lv >= 2) expect(p.cards.map((c) => c.cardId)).not.toContain('serial-both')
          }
        }
      }
    })
  }

  it('Lv1/Lv2 는 기본 핀을 쓰고 충돌 시 대체 핀을 배정한다', () => {
    const p = generateProblem({ mode: 'combo', sensors: ['pir', 'button'], difficulty: 1, seed: 1 })
    expect(p.pins.pir).toEqual({ out: 'D2' })
    expect(p.pins.button!.sig).not.toBe('D2')
    expect(p.leds[0].pin).toBe('D11')
    const q = generateProblem({ mode: 'combo', sensors: ['cds', 'line'], difficulty: 1, seed: 1 })
    expect(q.pins.cds).toEqual({ a0: 'A0' })
    expect(q.pins.line).toEqual({ d0: 'D3', a0: 'A1' })
  })

  it('같은 시드면 같은 문제', () => {
    const o = { mode: 'exam' as const, sensors: ['ultrasonic', 'cds'] as const, difficulty: 3 as const, seed: 777 }
    const a = generateProblem({ ...o, sensors: [...o.sensors] })
    const b = generateProblem({ ...o, sensors: [...o.sensors] })
    expect(a).toEqual(b)
    expect(a.key).toBe(problemKey({ ...o, sensors: [...o.sensors] }))
  })

  it('타이머: 실전 기본 40분 / Lv3 30분 / 설정값, 연습 Lv1 없음', () => {
    expect(generateProblem({ mode: 'exam', sensors: ['pir', 'ir'], difficulty: 2, seed: 1 }).timeLimitSec).toBe(2400)
    expect(generateProblem({ mode: 'exam', sensors: ['pir', 'ir'], difficulty: 3, seed: 1 }).timeLimitSec).toBe(1800)
    expect(generateProblem({ mode: 'exam', sensors: ['pir', 'ir'], difficulty: 2, seed: 1, timerMinutes: 25 }).timeLimitSec).toBe(1500)
    expect(generateProblem({ mode: 'combo', sensors: ['pir', 'ir'], difficulty: 1, seed: 1 }).timeLimitSec).toBeNull()
  })

  it('실습 URL 왕복', () => {
    const url = practiceUrl({ mode: 'exam', sensors: ['dht11', 'line'], difficulty: 3, seed: 42, timerMinutes: 30 })
    const parsed = parsePracticeParams(new URLSearchParams(url.split('?')[1]))
    expect(parsed).toEqual({ mode: 'exam', sensors: ['dht11', 'line'], difficulty: 3, seed: 42, timerMinutes: 30, template: undefined })
  })
})
