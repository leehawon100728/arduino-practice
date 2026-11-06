import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Difficulty, SensorId } from '../types'
import { SENSORS, getSensor } from '../data/sensors'
import { ALL_COMBOS, comboKey, newSeed } from '../lib/problem'
import { practiceUrl } from '../lib/route'
import { loadProgress } from '../lib/storage'
import DifficultyPicker from '../components/DifficultyPicker'

export default function ComboSelect() {
  const nav = useNavigate()
  const [picked, setPicked] = useState<SensorId[]>([])
  const [lv, setLv] = useState<Difficulty>(1)
  const attempts = loadProgress().attempts.filter((a) => a.sensors.length === 2)
  const best = (k: string) => attempts.filter((a) => comboKey(a.sensors) === k).reduce((m, a) => Math.max(m, a.score), -1)

  const toggle = (id: SensorId) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? [p[1], id] : [...p, id]))

  const start = (sensors: SensorId[]) => nav(practiceUrl({ mode: 'combo', sensors, difficulty: lv, seed: newSeed() }))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">조합 연습</h1>
      <DifficultyPicker value={lv} onChange={setLv} />

      <section>
        <h2 className="panel-title mb-2">센서 2개 고르기</h2>
        <div className="flex flex-wrap gap-2" role="group" aria-label="센서 선택">
          {SENSORS.map((s) => {
            const on = picked.includes(s.id)
            return (
              <button key={s.id} type="button" aria-pressed={on} onClick={() => toggle(s.id)}
                className={`btn ${on ? 'bg-brand-600 text-white' : 'btn-ghost'}`}>
                <span aria-hidden>{s.icon}</span>{s.shortName}
              </button>
            )
          })}
          <button type="button" className="btn-primary ml-auto" disabled={picked.length !== 2} onClick={() => start(picked)}>
            시작하기 →
          </button>
        </div>
      </section>

      <section>
        <h2 className="panel-title mb-2">전체 조합 (21개)</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ALL_COMBOS.map((c) => {
            const b = best(comboKey(c))
            return (
              <button key={comboKey(c)} type="button" onClick={() => start(c)} className="card flex items-center gap-2 p-3 text-left text-sm hover:border-brand-500">
                <span aria-hidden>{getSensor(c[0]).icon}{getSensor(c[1]).icon}</span>
                <span>{getSensor(c[0]).shortName} + {getSensor(c[1]).shortName}</span>
                <span className={`ml-auto text-xs ${b < 0 ? 'text-slate-400' : b >= 80 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {b < 0 ? '미도전' : `최고 ${b}점`}
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
