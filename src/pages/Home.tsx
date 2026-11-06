import { Link } from 'react-router-dom'
import { loadProgress } from '../lib/storage'
import { DIFFICULTIES } from '../data/difficulty'
import SensorChip from '../components/SensorChip'

const MODES = [
  { to: '/basics', icon: '🧱', title: '기본기', desc: 'Blink, 외부 LED, 시리얼 출력, DHT11 출력 템플릿으로 기초 다지기' },
  { to: '/sensors', icon: '🔬', title: '센서별 연습', desc: '7개 센서를 하나씩 배선·코딩·채점. 힌트와 모범답안 제공' },
  { to: '/combo', icon: '🧩', title: '조합 연습', desc: '센서 2개를 직접 골라 21가지 조합을 난이도별로 연습' },
  { to: '/exam', icon: '⏱️', title: '실전 모드', desc: '랜덤 2개 출제 + 타이머. 힌트와 모범답안은 제출 후 공개' },
  { to: '/review', icon: '🎯', title: '약점 복습', desc: '점수가 낮았던 센서와 조합을 더 자주 출제' },
]

const MODE_LABEL: Record<string, string> = { basics: '기본기', single: '센서별', combo: '조합', exam: '실전', review: '복습' }

export default function Home() {
  const recent = loadProgress().attempts.slice(0, 6)
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold">사물인터넷과 센서제어 수행평가 연습</h1>
        <p className="mt-1 text-slate-600 dark:text-slate-400">
          센서 2개를 브레드보드에 조립하고, 하나의 스케치로 두 센서 값을 읽어 LED 로 출력해 보세요. 실제 시험보다 조금 더 어렵게 연습합니다.
        </p>
      </section>

      <section aria-labelledby="modes" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <h2 id="modes" className="sr-only">연습 모드</h2>
        {MODES.map((m) => (
          <Link key={m.to} to={m.to} className="card group p-5 transition hover:-translate-y-0.5 hover:border-brand-500">
            <div className="text-3xl" aria-hidden>{m.icon}</div>
            <div className="mt-2 text-lg font-semibold group-hover:text-brand-700 dark:group-hover:text-brand-500">{m.title}</div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{m.desc}</p>
          </Link>
        ))}
      </section>

      <section aria-labelledby="recent">
        <h2 id="recent" className="mb-3 text-lg font-semibold">최근 기록</h2>
        {recent.length === 0 ? (
          <p className="card p-5 text-sm text-slate-500">아직 기록이 없어요. 센서별 연습부터 시작해 보세요!</p>
        ) : (
          <ul className="card divide-y divide-slate-100 dark:divide-slate-800">
            {recent.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <span className="w-14 text-slate-500">{MODE_LABEL[a.mode]}</span>
                {a.sensors.map((s) => <SensorChip key={s} id={s} />)}
                <span className="text-xs text-slate-500">{DIFFICULTIES[a.difficulty].name}</span>
                <span className={`ml-auto font-bold ${a.score >= 80 ? 'text-emerald-600' : 'text-rose-600'}`}>{a.score}점</span>
                <time className="text-xs text-slate-400">{new Date(a.date).toLocaleDateString('ko-KR')}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
