// ─────────────────────────────────────────────────────────────
// 브레드보드 / 아두이노 UNO 좌표계
// 브레드보드 구멍은 (col, y) 격자로 표현한다. y 는 피치(20px) 단위.
//   y=0  : 위쪽 + 레일        y=1  : 위쪽 − 레일
//   y=3~7: a~e 열 (위 단자줄)  y=8,9: 중앙 홈 (구멍 없음)
//   y=10~14: f~j 열 (아래 단자줄)
//   y=16 : 아래쪽 + 레일      y=17 : 아래쪽 − 레일
// 홈을 3피치로 둬서 푸시버튼(세로 다리 간격 3)이 홈을 가로질러 꽂힌다.
// ─────────────────────────────────────────────────────────────

export const PITCH = 20
export const BB_COLS = 30
export const BB = { x: 380, y: 40, w: 40 + (BB_COLS - 1) * PITCH + 20, h: 25 + 17 * PITCH + 30 }
export const VIEW = { w: 1040, h: BB.y + BB.h + 20 }

export const RAIL_ROWS = [0, 1, 16, 17] as const
export const TOP_ROWS = [3, 4, 5, 6, 7] as const
export const BOT_ROWS = [10, 11, 12, 13, 14] as const
export const ROW_LETTER: Record<number, string> = { 3: 'a', 4: 'b', 5: 'c', 6: 'd', 7: 'e', 10: 'f', 11: 'g', 12: 'h', 13: 'i', 14: 'j' }
export const RAIL_SIGN: Record<number, '+' | '−'> = { 0: '+', 1: '−', 16: '+', 17: '−' }

export function holeXY(col: number, y: number) {
  return { x: BB.x + 30 + (col - 1) * PITCH, y: BB.y + 25 + y * PITCH }
}

export function isHoleRow(y: number) {
  return (RAIL_ROWS as readonly number[]).includes(y) || (TOP_ROWS as readonly number[]).includes(y) || (BOT_ROWS as readonly number[]).includes(y)
}

export function isHole(col: number, y: number) {
  return Number.isInteger(col) && Number.isInteger(y) && col >= 1 && col <= BB_COLS && isHoleRow(y)
}

/** 구멍이 속한 내부 연결 노드 (같은 노드 = 브레드보드 안에서 이미 연결됨) */
export function holeNode(col: number, y: number): string {
  if ((RAIL_ROWS as readonly number[]).includes(y)) return `R${y}`
  if ((TOP_ROWS as readonly number[]).includes(y)) return `T${col}`
  return `B${col}`
}

export const holeId = (col: number, y: number) => `H:${col}:${y}`

export function holeName(col: number, y: number) {
  if (ROW_LETTER[y]) return `${ROW_LETTER[y]}${col}`
  return `${y < 8 ? '위' : '아래'} ${RAIL_SIGN[y]}레일 ${col}`
}

/** 화면 좌표 → 가장 가까운 구멍 (없으면 null) */
export function nearestHole(x: number, y: number, maxDist = PITCH * 0.6) {
  const col = Math.round((x - BB.x - 30) / PITCH) + 1
  const row = Math.round((y - BB.y - 25) / PITCH)
  if (!isHole(col, row)) return null
  const p = holeXY(col, row)
  if (Math.hypot(p.x - x, p.y - y) > maxDist) return null
  return { col, y: row }
}

// ─── 아두이노 UNO ────────────────────────────────────────────

export const UNO = { x: 20, y: 110, w: 340, h: 250 }

export interface ArduinoPinDef {
  id: string // 포인트 id 에 쓰는 이름 (P:id)
  node: string // 전기 노드 (GND 핀 3개는 같은 노드)
  label: string
  x: number
  y: number
  side: 'top' | 'bottom'
  pwm?: boolean
}

const TOP_Y = UNO.y + 14
const BOT_Y = UNO.y + UNO.h - 14
const SP = 16

function buildPins(): ArduinoPinDef[] {
  const pins: ArduinoPinDef[] = []
  const pwm = new Set([3, 5, 6, 9, 10, 11])
  let x = UNO.x + 50
  const top1 = ['AREF', 'GND1', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8']
  for (const id of top1) {
    pins.push(mkTop(id, x))
    x += SP
  }
  x += 10
  for (let d = 7; d >= 0; d--) {
    pins.push(mkTop(`D${d}`, x))
    x += SP
  }
  function mkTop(id: string, px: number): ArduinoPinDef {
    const n = id.startsWith('D') ? Number(id.slice(1)) : -1
    const label = id === 'GND1' ? 'GND' : n >= 0 ? `${pwm.has(n) ? '~' : ''}${n}${n === 1 ? 'TX' : n === 0 ? 'RX' : ''}` : id
    return { id, node: id.startsWith('GND') ? 'GND' : id, label, x: px, y: TOP_Y, side: 'top', pwm: pwm.has(n) }
  }
  let bx = UNO.x + 100
  const power: [string, string][] = [['IOREF', 'IOREF'], ['RESET', 'RESET'], ['3V3', '3.3V'], ['5V', '5V'], ['GND2', 'GND'], ['GND3', 'GND'], ['VIN', 'Vin']]
  for (const [id, label] of power) {
    pins.push({ id, node: id.startsWith('GND') ? 'GND' : id, label, x: bx, y: BOT_Y, side: 'bottom' })
    bx += SP
  }
  bx += 12
  for (let a = 0; a <= 5; a++) {
    pins.push({ id: `A${a}`, node: `A${a}`, label: `A${a}`, x: bx, y: BOT_Y, side: 'bottom' })
    bx += SP
  }
  return pins
}

export const ARDUINO_PINS: ArduinoPinDef[] = buildPins()
export const ARDUINO_PIN_MAP: Record<string, ArduinoPinDef> = Object.fromEntries(ARDUINO_PINS.map((p) => [p.id, p]))

/** 포인트 id → 화면 좌표 */
export function pointXY(pointId: string) {
  if (pointId.startsWith('H:')) {
    const [, c, y] = pointId.split(':')
    return holeXY(Number(c), Number(y))
  }
  const p = ARDUINO_PIN_MAP[pointId.slice(2)]
  return { x: p.x, y: p.y }
}

/** 포인트 id → 전기 노드 */
export function pointNode(pointId: string) {
  if (pointId.startsWith('H:')) {
    const [, c, y] = pointId.split(':')
    return holeNode(Number(c), Number(y))
  }
  return ARDUINO_PIN_MAP[pointId.slice(2)].node
}

export function pointName(pointId: string) {
  if (pointId.startsWith('H:')) {
    const [, c, y] = pointId.split(':')
    return holeName(Number(c), Number(y))
  }
  const p = ARDUINO_PIN_MAP[pointId.slice(2)]
  return `아두이노 ${p.node.startsWith('D') ? p.node : p.label}`
}

/** 아두이노 핀 번호(0~19) ↔ 노드 이름 */
export function pinNumberToNode(pin: number): string | null {
  if (pin >= 0 && pin <= 13) return `D${pin}`
  if (pin >= 14 && pin <= 19) return `A${pin - 14}`
  return null
}
export function nodeToPinNumber(node: string): number | null {
  if (/^D\d+$/.test(node)) return Number(node.slice(1))
  if (/^A\d$/.test(node)) return 14 + Number(node.slice(1))
  return null
}
