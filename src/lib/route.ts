import type { Difficulty, Mode, SensorId } from '../types'
import { SENSOR_IDS } from '../data/sensors'

export interface PracticeParams {
  mode: Mode
  sensors: SensorId[]
  difficulty: Difficulty
  seed: number
  timerMinutes?: number
  template?: string
}

/** 실습 화면 주소. 같은 주소면 같은 문제가 다시 만들어진다. */
export function practiceUrl(p: PracticeParams) {
  const q = new URLSearchParams({ mode: p.mode, lv: String(p.difficulty), seed: String(p.seed) })
  if (p.sensors.length) q.set('s', p.sensors.join(','))
  if (p.timerMinutes) q.set('t', String(p.timerMinutes))
  if (p.template) q.set('tpl', p.template)
  return `/practice?${q.toString()}`
}

export function parsePracticeParams(q: URLSearchParams): PracticeParams | null {
  const mode = q.get('mode') as Mode | null
  if (!mode || !['basics', 'single', 'combo', 'exam', 'review'].includes(mode)) return null
  const sensors = (q.get('s') ?? '').split(',').filter((s): s is SensorId => SENSOR_IDS.includes(s as SensorId))
  const lv = Number(q.get('lv') ?? 1)
  const difficulty = (lv === 2 || lv === 3 ? lv : 1) as Difficulty
  const seed = Number(q.get('seed') ?? 1) || 1
  const t = Number(q.get('t'))
  const template = q.get('tpl') ?? undefined
  if (mode !== 'basics' && sensors.length === 0) return null
  return { mode, sensors: [...new Set(sensors)].slice(0, 2), difficulty, seed, timerMinutes: t > 0 ? t : undefined, template }
}
