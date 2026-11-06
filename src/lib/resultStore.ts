import type { GradeReport } from '../grading/grade'
import type { Circuit } from '../sim/parts'
import type { PracticeParams } from './route'

export interface StoredResult {
  params: PracticeParams
  report: GradeReport
  code: string
  circuit: Circuit
  hintsUsed: number
  durationSec: number
  date: string
}

const KEY = 'arduino-practice:last-result'
let memory: StoredResult | null = null

export function saveResult(r: StoredResult) {
  memory = r
  try { sessionStorage.setItem(KEY, JSON.stringify(r)) } catch { /* 무시 */ }
}

export function loadResult(): StoredResult | null {
  if (memory) return memory
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as StoredResult) : null
  } catch {
    return null
  }
}

/** 에디터에 코드 불러오기: 실습 화면의 초안 저장소에 써 둔다 */
export function writeDraft(key: string, code: string) {
  try { localStorage.setItem(`arduino-practice:draft:${key}`, code) } catch { /* 무시 */ }
}
export function readDraft(key: string) {
  try { return localStorage.getItem(`arduino-practice:draft:${key}`) } catch { return null }
}
export function writeCircuitDraft(key: string, c: Circuit) {
  try { localStorage.setItem(`arduino-practice:circuit:${key}`, JSON.stringify(c)) } catch { /* 무시 */ }
}
export function readCircuitDraft(key: string): Circuit | null {
  try {
    const raw = localStorage.getItem(`arduino-practice:circuit:${key}`)
    if (!raw) return null
    const c = JSON.parse(raw) as Circuit
    return Array.isArray(c.parts) && Array.isArray(c.wires) ? c : null
  } catch {
    return null
  }
}
