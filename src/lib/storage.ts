import type { AttemptRecord, ProgressData, SensorId } from '../types'
import { SENSOR_IDS } from '../data/sensors'
import { ALL_COMBOS, comboKey, type Rng } from './problem'

const KEY = 'arduino-practice:progress'

function empty(): ProgressData {
  return { version: 1, attempts: [] }
}

/** localStorage 가 막혀 있어도(시크릿 창 등) 앱이 죽지 않게 감싼다 */
export function loadProgress(): ProgressData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const data = JSON.parse(raw) as ProgressData
    return data.version === 1 && Array.isArray(data.attempts) ? data : empty()
  } catch {
    return empty()
  }
}

export function saveProgress(data: ProgressData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* 저장 실패는 무시 */
  }
}

export function addAttempt(rec: AttemptRecord) {
  const data = loadProgress()
  data.attempts.unshift(rec)
  data.attempts = data.attempts.slice(0, 300)
  saveProgress(data)
}

export function clearProgress() {
  saveProgress(empty())
}

export const PASS_SCORE = 80

/** 센서 단독 연습 통계 */
export function sensorStats(data: ProgressData, id: SensorId) {
  const list = data.attempts.filter((a) => a.mode === 'single' && a.sensors[0] === id)
  const best = list.reduce((m, a) => Math.max(m, a.score), 0)
  return { tries: list.length, best, done: best >= PASS_SCORE }
}

/**
 * 약점 가중치: 최근 기록에서 점수가 낮을수록 가중치가 커진다.
 * 한 번도 안 푼 조합은 기본 가중치 1.
 */
export function weaknessWeights(data: ProgressData) {
  const sensor: Record<string, number> = Object.fromEntries(SENSOR_IDS.map((s) => [s, 1]))
  const combo: Record<string, number> = Object.fromEntries(ALL_COMBOS.map((c) => [comboKey(c), 1]))
  const recent = data.attempts.slice(0, 80)
  recent.forEach((a, i) => {
    const recency = 1 - i / (recent.length + 1) // 최근일수록 1 에 가까움
    const miss = (100 - a.score) / 100 // 0 = 만점, 1 = 0점
    const delta = (miss * 3 - 0.5) * recency // 잘 풀면 조금 감소, 못 풀면 크게 증가
    for (const s of a.sensors) sensor[s] = Math.max(0.2, (sensor[s] ?? 1) + delta)
    if (a.sensors.length === 2) {
      const k = comboKey(a.sensors)
      combo[k] = Math.max(0.2, (combo[k] ?? 1) + delta * 1.5)
    }
  })
  return { sensor, combo }
}

/** 가중치로 조합 하나 뽑기 (조합 가중치 × 두 센서 가중치) */
export function pickWeakCombo(data: ProgressData, rng: Rng): [SensorId, SensorId] {
  const w = weaknessWeights(data)
  const scored = ALL_COMBOS.map((c) => ({ c, w: w.combo[comboKey(c)] * Math.sqrt(w.sensor[c[0]] * w.sensor[c[1]]) }))
  const total = scored.reduce((s, x) => s + x.w, 0)
  let r = rng() * total
  for (const x of scored) {
    r -= x.w
    if (r <= 0) return x.c
  }
  return scored[scored.length - 1].c
}
