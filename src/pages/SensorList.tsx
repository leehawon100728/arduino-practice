import { Link } from 'react-router-dom'
import { SENSORS } from '../data/sensors'
import { loadProgress, sensorStats } from '../lib/storage'
import { practiceUrl } from '../lib/route'

export default function SensorList() {
  const data = loadProgress()
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">센서별 연습</h1>
      <p className="text-slate-600 dark:text-slate-400">센서 하나 + LED 하나. 80점 이상이면 완료로 표시돼요.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SENSORS.map((s) => {
          const st = sensorStats(data, s.id)
          return (
            <Link key={s.id} to={practiceUrl({ mode: 'single', sensors: [s.id], difficulty: 1, seed: 1 })} className="card group relative p-5 hover:border-brand-500">
              {st.done && <span className="chip absolute right-3 top-3 bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100">✓ 완료</span>}
              <div className="text-3xl" aria-hidden>{s.icon}</div>
              <h2 className="mt-2 font-semibold group-hover:text-brand-700 dark:group-hover:text-brand-500">{s.name}</h2>
              <div className="text-xs text-slate-500">{s.model} · {s.readMethods.join(', ')}</div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{s.summary}</p>
              <div className="mt-3 text-xs text-slate-500">
                {st.tries ? `최고 ${st.best}점 · ${st.tries}회 시도` : '아직 시도하지 않음'}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
