import { useNavigate } from 'react-router-dom'
import { SENSORS, getSensor } from '../data/sensors'
import { ALL_COMBOS, comboKey, mulberry32, newSeed } from '../lib/problem'
import { loadProgress, pickWeakCombo, weaknessWeights } from '../lib/storage'
import { practiceUrl } from '../lib/route'

export default function Review() {
  const nav = useNavigate()
  const data = loadProgress()
  const w = weaknessWeights(data)
  const weakCombos = [...ALL_COMBOS].sort((a, b) => w.combo[comboKey(b)] - w.combo[comboKey(a)]).slice(0, 5)
  const maxSensor = Math.max(...Object.values(w.sensor))

  const start = () => {
    const seed = newSeed()
    const combo = pickWeakCombo(data, mulberry32(seed))
    nav(practiceUrl({ mode: 'review', sensors: [...combo], difficulty: 2, seed }))
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">약점 복습</h1>
      <p className="text-slate-600 dark:text-slate-400">점수가 낮았던 센서와 조합일수록 더 자주 출제돼요. (Lv2 시험 수준)</p>
      {data.attempts.length === 0 && (
        <p className="card p-4 text-sm text-slate-500">아직 기록이 없어서 모든 조합이 같은 확률로 나와요.</p>
      )}
      <section className="card p-5">
        <h2 className="panel-title mb-3">센서별 약점 지수</h2>
        <ul className="space-y-2">
          {SENSORS.map((s) => (
            <li key={s.id} className="flex items-center gap-3 text-sm">
              <span className="w-24">{s.icon} {s.shortName}</span>
              <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800" role="meter" aria-valuenow={Math.round(w.sensor[s.id] * 100)} aria-label={`${s.shortName} 약점 지수`}>
                <div className="h-full bg-rose-500" style={{ width: `${(w.sensor[s.id] / maxSensor) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="panel-title mb-2">자주 나올 조합 TOP 5</h2>
        <ol className="flex flex-wrap gap-2 text-sm">
          {weakCombos.map((c) => (
            <li key={comboKey(c)} className="chip bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200">
              {getSensor(c[0]).shortName} + {getSensor(c[1]).shortName}
            </li>
          ))}
        </ol>
      </section>
      <button type="button" className="btn-primary px-6 py-3 text-base" onClick={start}>🎯 약점 문제 풀기</button>
    </div>
  )
}
