import { Link } from 'react-router-dom'
import { BASIC_TEMPLATES } from '../data/templates'
import { practiceUrl } from '../lib/route'

export default function Basics() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">기본기 모드</h1>
      <p className="text-slate-600 dark:text-slate-400">템플릿 코드를 불러와 시뮬레이터에서 직접 실행해 보세요.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {BASIC_TEMPLATES.map((t) => (
          <article key={t.id} className="card flex flex-col p-5">
            <h2 className="text-lg font-semibold">{t.title}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t.summary}</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-400">
              {t.explanation.slice(0, 2).map((e) => <li key={e}>{e}</li>)}
            </ul>
            <Link
              to={practiceUrl({ mode: 'basics', sensors: t.parts.includes('dht11') ? ['dht11'] : [], difficulty: 1, seed: 1, template: t.id })}
              className="btn-primary mt-4 self-start"
            >
              열기 →
            </Link>
          </article>
        ))}
      </div>
    </div>
  )
}
