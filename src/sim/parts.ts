import type { SensorId } from '../types'
import { isHole, holeId, holeNode, pointNode } from './geometry'

// ─── 부품 정의 ───────────────────────────────────────────────

export type CircuitPartKind =
  | 'pir' | 'dht11' | 'ultrasonic' | 'line' | 'ir' | 'cds' | 'pushbutton'
  | 'led-red' | 'led-green' | 'led-blue' | 'res-220' | 'res-10k'

export interface LegDef { id: string; label: string; dx: number; dy: number }

export interface PartDef {
  kind: CircuitPartKind
  label: string
  legs: LegDef[]
  /** 이 부품을 조작하는 가상 센서 */
  sensor?: SensorId
  /** 항상 내부에서 연결된 다리 쌍 */
  internal?: [string, string][]
  /** 저항값 (Ω) */
  ohms?: number
  /** 모듈 (VCC/GND 가 있는 센서 보드) */
  module?: boolean
}

const row = (labels: [string, string][]): LegDef[] => labels.map(([id, label], i) => ({ id, label, dx: i, dy: 0 }))

export const PART_DEFS: Record<CircuitPartKind, PartDef> = {
  pir: { kind: 'pir', label: 'PIR 센서', sensor: 'pir', module: true, legs: row([['vcc', 'VCC'], ['out', 'OUT'], ['gnd', 'GND']]) },
  dht11: { kind: 'dht11', label: 'DHT11', sensor: 'dht11', module: true, legs: row([['vcc', 'VCC'], ['data', 'DATA'], ['gnd', 'GND']]) },
  ultrasonic: { kind: 'ultrasonic', label: '초음파 HC-SR04', sensor: 'ultrasonic', module: true, legs: row([['vcc', 'VCC'], ['trig', 'Trig'], ['echo', 'Echo'], ['gnd', 'GND']]) },
  line: { kind: 'line', label: '라인센서', sensor: 'line', module: true, legs: row([['vcc', 'VCC'], ['gnd', 'GND'], ['d0', 'D0'], ['a0', 'A0']]) },
  ir: { kind: 'ir', label: 'IR 장애물', sensor: 'ir', module: true, legs: row([['vcc', 'VCC'], ['gnd', 'GND'], ['out', 'OUT']]) },
  cds: { kind: 'cds', label: '조도(CDS)', sensor: 'cds', module: true, legs: row([['vcc', 'VCC'], ['ao', 'AO'], ['gnd', 'GND']]) },
  pushbutton: {
    kind: 'pushbutton', label: '푸시버튼', sensor: 'button',
    legs: [
      { id: 'a1', label: '1', dx: 0, dy: 0 },
      { id: 'a2', label: '2', dx: 0, dy: 3 },
      { id: 'b1', label: '3', dx: 2, dy: 0 },
      { id: 'b2', label: '4', dx: 2, dy: 3 },
    ],
    internal: [['a1', 'a2'], ['b1', 'b2']],
  },
  'led-red': { kind: 'led-red', label: 'LED 빨강', legs: row([['anode', '+'], ['cathode', '−']]) },
  'led-green': { kind: 'led-green', label: 'LED 초록', legs: row([['anode', '+'], ['cathode', '−']]) },
  'led-blue': { kind: 'led-blue', label: 'LED 파랑', legs: row([['anode', '+'], ['cathode', '−']]) },
  'res-220': { kind: 'res-220', label: '저항 220Ω', ohms: 220, legs: [{ id: 'r1', label: '1', dx: 0, dy: 0 }, { id: 'r2', label: '2', dx: 0, dy: 4 }] },
  'res-10k': { kind: 'res-10k', label: '저항 10kΩ', ohms: 10000, legs: [{ id: 'r1', label: '1', dx: 0, dy: 0 }, { id: 'r2', label: '2', dx: 0, dy: 4 }] },
}

export const isLed = (k: CircuitPartKind) => k.startsWith('led-')
export const isResistor = (k: CircuitPartKind) => k.startsWith('res-')

export const SENSOR_PART: Record<SensorId, CircuitPartKind> = {
  pir: 'pir', dht11: 'dht11', ultrasonic: 'ultrasonic', line: 'line', ir: 'ir', cds: 'cds', button: 'pushbutton',
}

// ─── 회로 ────────────────────────────────────────────────────

export type Rot = 0 | 1 | 2 | 3

export interface PlacedPart {
  id: string
  kind: CircuitPartKind
  col: number
  y: number
  rot: Rot
  /** 다리를 구부려서 기본 위치가 아닌 다른 구멍에 꽂았을 때 (legId → 구멍) */
  bend?: Record<string, { col: number; y: number }>
}

export interface Wire {
  id: string
  a: string // 포인트 id (H:col:y 또는 P:핀)
  b: string
  color: string
}

export interface Circuit {
  parts: PlacedPart[]
  wires: Wire[]
}

export const emptyCircuit = (): Circuit => ({ parts: [], wires: [] })

export function rotate(dx: number, dy: number, rot: Rot): [number, number] {
  switch (rot) {
    case 0: return [dx, dy]
    case 1: return [-dy, dx]
    case 2: return [-dx, -dy]
    case 3: return [dy, -dx]
  }
}

/** 부품 다리들이 꽂힌 구멍 (구부린 다리는 bend 의 절대 위치를 쓴다) */
export function legHoles(p: Pick<PlacedPart, 'kind' | 'col' | 'y' | 'rot'> & { bend?: PlacedPart['bend'] }) {
  return PART_DEFS[p.kind].legs.map((l) => {
    const bent = p.bend?.[l.id]
    if (bent) return { leg: l, col: bent.col, y: bent.y }
    const [dx, dy] = rotate(l.dx, l.dy, p.rot)
    return { leg: l, col: p.col + dx, y: p.y + dy }
  })
}

/** 다리 하나를 (col, y) 구멍으로 옮길 수 있는가 (다른 다리/선이 없는 빈 구멍이어야 함) */
export function canPlaceLeg(c: Circuit, partId: string, legId: string, col: number, y: number) {
  if (!isHole(col, y)) return false
  const part = c.parts.find((p) => p.id === partId)
  if (!part) return false
  const occ = occupiedHoles(c)
  const current = legHoles(part).find((h) => h.leg.id === legId)
  if (current) occ.delete(holeId(current.col, current.y))
  return !occ.has(holeId(col, y))
}

/** 부품을 이 위치에 놓을 수 있는가 (구멍 밖/겹침 검사) */
export function canPlace(c: Circuit, p: Pick<PlacedPart, 'kind' | 'col' | 'y' | 'rot'> & { bend?: PlacedPart['bend'] }, ignoreId?: string) {
  const holes = legHoles(p)
  if (!holes.every((h) => isHole(h.col, h.y))) return false
  const used = occupiedHoles(c, ignoreId)
  return holes.every((h) => !used.has(holeId(h.col, h.y)))
}

/** 부품 다리 / 선 끝이 차지한 구멍 */
export function occupiedHoles(c: Circuit, ignorePartId?: string, ignoreWireId?: string) {
  const s = new Set<string>()
  for (const p of c.parts) {
    if (p.id === ignorePartId) continue
    for (const h of legHoles(p)) s.add(holeId(h.col, h.y))
  }
  for (const w of c.wires) {
    if (w.id === ignoreWireId) continue
    if (w.a.startsWith('H:')) s.add(w.a)
    if (w.b.startsWith('H:')) s.add(w.b)
  }
  return s
}

// ─── 넷리스트 (union-find) ───────────────────────────────────

export class Netlist {
  private parent = new Map<string, string>()
  /** partId → legId → 노드 */
  readonly legNode = new Map<string, Record<string, string>>()

  constructor(readonly circuit: Circuit, opts: { pressed?: boolean } = {}) {
    for (const w of circuit.wires) this.union(pointNode(w.a), pointNode(w.b))
    for (const p of circuit.parts) {
      const m: Record<string, string> = {}
      for (const h of legHoles(p)) m[h.leg.id] = isHole(h.col, h.y) ? holeNode(h.col, h.y) : `X:${p.id}:${h.leg.id}`
      this.legNode.set(p.id, m)
      const def = PART_DEFS[p.kind]
      for (const [a, b] of def.internal ?? []) this.union(m[a], m[b])
      if (p.kind === 'pushbutton' && opts.pressed) this.union(m.a1, m.b1)
    }
  }

  find(x: string): string {
    let r = x
    while (this.parent.has(r) && this.parent.get(r) !== r) r = this.parent.get(r)!
    // 경로 압축
    let c = x
    while (this.parent.has(c) && this.parent.get(c) !== r) {
      const n = this.parent.get(c)!
      this.parent.set(c, r)
      c = n
    }
    return r
  }

  union(a: string, b: string) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    // GND, 5V 같은 아두이노 노드가 대표가 되도록
    const prio = (n: string) => (n === 'GND' ? 3 : n === '5V' ? 2 : /^[DA]\d+$/.test(n) ? 1 : 0)
    if (prio(rb) > prio(ra)) this.parent.set(ra, rb)
    else this.parent.set(rb, ra)
  }

  same(a: string, b: string) {
    return this.find(a) === this.find(b)
  }

  /** 부품 다리의 넷 */
  net(partId: string, legId: string) {
    const m = this.legNode.get(partId)
    return m ? this.find(m[legId]) : null
  }
}
