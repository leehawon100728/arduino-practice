import { describe, expect, it } from 'vitest'
import type { AppliedCard, Difficulty, Problem, SensorId } from '../types'
import { SENSOR_IDS } from '../data/sensors'
import { CARDS } from '../data/cards'
import { ALL_COMBOS, cardTargets, generateProblem } from '../lib/problem'
import { composeSolution, solutionVariants } from '../lib/solution'
import { buildModelCircuit } from '../sim/modelCircuit'
import { compileSource } from '../interp/compiler'
import { grade, type GradeReport } from './grade'

function fails(r: GradeReport) {
  return r.items.filter((i) => !i.ok).map((i) => `[${i.section}] ${i.label}: ${i.message}`)
}

function check(p: Problem, code = composeSolution(p)) {
  const c = compileSource(code)
  if (!c.ok) throw new Error(`${p.key} 컴파일 실패: ${c.errors[0].line}: ${c.errors[0].message}\n${code}`)
  const r = grade({ problem: p, code, circuit: buildModelCircuit(p) })
  expect(fails(r), `${p.key}\n${code}`).toEqual([])
  expect(r.score).toBe(100)
  return r
}

describe('모범답안: 센서 단독 7개', () => {
  for (const id of SENSOR_IDS) {
    it(id, () => { check(generateProblem({ mode: 'single', sensors: [id], difficulty: 1, seed: 1 })) })
  }
})

describe('모범답안: 조합 21개', () => {
  for (const lv of [1, 2] as Difficulty[]) {
    for (const combo of ALL_COMBOS) {
      it(`Lv${lv} ${combo.join('+')}`, () => {
        const p = generateProblem({ mode: 'combo', sensors: [...combo], difficulty: lv, seed: 1, cards: [] })
        const r = check(p)
        expect(r.readLines.length).toBeGreaterThan(0)
        expect(r.writeLines.length).toBeGreaterThan(0)
      })
    }
  }
  for (const combo of ALL_COMBOS) {
    it(`Lv3 ${combo.join('+')} (랜덤 핀, 카드 없음)`, () => {
      check(generateProblem({ mode: 'combo', sensors: [...combo], difficulty: 3, seed: 7, cards: [] }))
    })
  }
})

describe('모범답안: 다른 방법 (OR, DHT.h, 풀업, 라인 A0)', () => {
  it('OR 버전', () => {
    const p = generateProblem({ mode: 'combo', sensors: ['pir', 'cds'], difficulty: 1, seed: 1, cards: [] })
    check(p, composeSolution(p, { logic: 'OR' }))
  })
  it('모든 변형이 통과', () => {
    for (const combo of [['dht11', 'button'], ['line', 'ultrasonic'], ['button', 'pot']] as SensorId[][]) {
      const p = generateProblem({ mode: 'combo', sensors: combo, difficulty: 2, seed: 3, cards: [] })
      for (const v of solutionVariants(p)) {
        const prob = v.id === 'button-alt0' ? { ...p, buttonMode: 'pullup' as const } : p
        const c = compileSource(v.code)
        expect(c.ok, v.title).toBe(true)
        const r = grade({ problem: prob, code: v.code, circuit: buildModelCircuit(prob) })
        expect(fails(r), `${p.key} / ${v.title}\n${v.code}`).toEqual([])
      }
    }
  })
})

describe('추가 요구 카드별 예시 코드', () => {
  // 카드마다 적용 가능한 모든 조합에서 (변형 포함) 카드 규칙을 통과해야 한다
  for (const card of CARDS) {
    const variants = card.variants?.map((v) => v.id) ?? [undefined]
    for (const variantId of variants) {
      it(`${card.number}. ${card.title}${variantId ? ` (${variantId})` : ''}`, () => {
        let tested = 0
        for (const combo of ALL_COMBOS) {
          const targets = cardTargets(card, [...combo])
          if (!targets.length) continue
          const target = card.target && card.target !== 'any' ? targets[tested % targets.length] : undefined
          const applied: AppliedCard = { cardId: card.id, variantId, target }
          const lv = Math.max(card.minDifficulty, 2) as Difficulty
          const p = generateProblem({ mode: 'combo', sensors: [...combo], difficulty: lv, seed: 11 + tested, cards: [applied] })
          check(p)
          tested++
        }
        expect(tested).toBeGreaterThan(0)
      })
    }
  }

  it('5초 출력 쉬운 버전 (loop 횟수 세기)', () => {
    const p = generateProblem({ mode: 'combo', sensors: ['pir', 'cds'], difficulty: 2, seed: 1, cards: [{ cardId: 'every-5s' }] })
    check(p, composeSolution(p, { easyPeriodic: true }))
    const q = generateProblem({ mode: 'combo', sensors: ['dht11', 'pot'], difficulty: 2, seed: 1, cards: [{ cardId: 'every-5s' }] })
    check(q, composeSolution(q, { easyPeriodic: true }))
  })

  it('실전/Lv3 랜덤 출제 (카드 1~2장) 모범답안 전부 만점', () => {
    for (const combo of ALL_COMBOS) {
      for (const seed of [101, 202]) {
        check(generateProblem({ mode: 'exam', sensors: [...combo], difficulty: 3, seed }))
      }
    }
  })
})

describe('채점기는 틀린 답을 잡아낸다', () => {
  const p = generateProblem({ mode: 'combo', sensors: ['ultrasonic', 'cds'], difficulty: 1, seed: 1, cards: [] })
  const circuit = buildModelCircuit(p)
  const good = composeSolution(p)

  it('센서 B 를 조건에 안 쓰면 동작 검사 감점', () => {
    const code = good.replace('isNear && isDark', 'isNear')
    const r = grade({ problem: p, code, circuit })
    const item = r.items.find((i) => i.id === 'beh.affect.cds')!
    expect(item.ok).toBe(false)
    expect(item.message).toContain('조도 센서 값이 LED 에 반영되지 않아요')
  })

  it('임계값이 범위 밖이면 이유를 알려준다', () => {
    const code = good.replace('distance < 20', 'distance > 500')
    const r = grade({ problem: p, code, circuit })
    expect(r.items.find((i) => i.id === 'beh.affect.ultrasonic')!.message).toContain('범위')
  })

  it('문법 오류는 코드/동작 0점', () => {
    const r = grade({ problem: p, code: good.replace('pinMode(trigPin, OUTPUT);', 'pinMode(trigPin, OUTPUT)'), circuit })
    expect(r.sections.code.score).toBe(0)
    expect(r.sections.behavior.score).toBe(0)
    expect(r.compileErrors[0].message).toContain('세미콜론')
  })

  it('Echo 선이 빠지면 구체적으로 알려준다', () => {
    const broken = { ...circuit, wires: circuit.wires.filter((w) => w.b !== 'P:D10') }
    const r = grade({ problem: p, code: good, circuit: broken })
    expect(r.items.find((i) => i.id === 'wire.ultrasonic.echo')!.message).toBe('초음파 거리 센서 Echo가 어느 핀에도 연결되지 않았어요. D10 에 연결하세요.')
  })

  it('LED 저항이 없으면 알려준다', () => {
    const noRes = {
      parts: [...circuit.parts.filter((x) => x.kind !== 'res-220'), { id: 'jump', kind: 'res-220' as const, col: 29, y: 3, rot: 0 as const }],
      wires: [...circuit.wires, { id: 'bypass', a: 'H:22:3', b: 'H:22:13', color: 'orange' }],
    }
    // 저항 자리를 선으로 바로 연결 (LED 위치는 모범 배선 기준)
    const led = circuit.parts.find((x) => x.kind.startsWith('led'))!
    noRes.wires[noRes.wires.length - 1] = { id: 'bypass', a: `H:${led.col}:3`, b: `H:${led.col}:13`, color: 'orange' }
    const r = grade({ problem: p, code: good, circuit: noRes })
    expect(r.items.find((i) => i.id === 'wire.led1')!.message).toContain('저항이 없어요')
  })

  it('힌트 감점', () => {
    const p2 = generateProblem({ mode: 'combo', sensors: ['pir', 'pot'], difficulty: 2, seed: 1, cards: [] })
    const r = grade({ problem: p2, code: composeSolution(p2), circuit: buildModelCircuit(p2), hintsUsed: 2 })
    expect(r.raw).toBe(100)
    expect(r.score).toBe(100 - 2 * p2.hintPenalty)
  })
})
