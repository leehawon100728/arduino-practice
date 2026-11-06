import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { Problem } from '../types'
import { DIFFICULTIES } from '../data/difficulty'
import { BASIC_TEMPLATES } from '../data/templates'
import { generateProblem, cardText } from '../lib/problem'
import { parsePracticeParams } from '../lib/route'
import { starterCode } from '../lib/starter'
import { fmtTime, useCountdown } from '../lib/useCountdown'
import CodeEditor from '../components/practice/CodeEditor'
import SensorControls, { defaultSensorValues, type SensorValues } from '../components/practice/SensorControls'
import SerialMonitor from '../components/practice/SerialMonitor'
import PartsTray from '../components/practice/PartsTray'
import CircuitCanvas from '../components/practice/CircuitCanvas'
import WiringGuide from '../components/practice/WiringGuide'
import HintPanel from '../components/practice/HintPanel'
import ThemeToggle from '../components/ThemeToggle'

type Drawer = null | 'hint' | 'guide' | 'about'

const MODE_LABEL = { basics: '기본기', single: '센서별 연습', combo: '조합 연습', exam: '실전 모드', review: '약점 복습' } as const

function loadDraft(key: string) {
  try { return localStorage.getItem(`arduino-practice:draft:${key}`) } catch { return null }
}
function saveDraft(key: string, code: string) {
  try { localStorage.setItem(`arduino-practice:draft:${key}`, code) } catch { /* 무시 */ }
}

export default function Practice() {
  const [q] = useSearchParams()
  const nav = useNavigate()
  const params = useMemo(() => parsePracticeParams(q), [q])
  const template = params?.template ? BASIC_TEMPLATES.find((t) => t.id === params.template) : undefined

  const problem: Problem | null = useMemo(() => {
    if (!params || params.sensors.length === 0) return null
    return generateProblem({ mode: params.mode, sensors: params.sensors, difficulty: params.difficulty, seed: params.seed, timerMinutes: params.timerMinutes })
  }, [params])

  const draftKey = template ? `tpl-${template.id}` : problem?.key ?? 'empty'
  const [code, setCode] = useState(() => loadDraft(draftKey) ?? template?.code ?? (problem ? starterCode(problem) : ''))
  useEffect(() => { saveDraft(draftKey, code) }, [draftKey, code])

  const [values, setValues] = useState<SensorValues>(() => defaultSensorValues(problem?.sensors ?? []))
  const [serial, setSerial] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [drawer, setDrawer] = useState<Drawer>(template ? 'about' : null)
  const [hintsOpened, setHintsOpened] = useState<Set<string>>(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [showStatement, setShowStatement] = useState(true)

  const submit = useCallback(() => {
    setSubmitted(true)
    setRunning(false)
    nav('/result') // 6단계: 채점 결과를 넘긴다
  }, [nav])

  const { elapsed, remaining } = useCountdown(problem?.timeLimitSec ?? null, !submitted && !!problem, submit)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!params) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="card p-8 text-center">
          <p>문제 주소가 올바르지 않아요.</p>
          <Link to="/" className="btn-primary mt-4">홈으로</Link>
        </div>
      </div>
    )
  }

  const locked = !!problem?.lockSolutionUntilSubmit && !submitted
  const lowTime = remaining != null && remaining <= 300

  const toggleRun = () => {
    setRunning((r) => {
      if (!r) setSerial((s) => [...s, '[시뮬레이터] 코드 실행 엔진은 3단계에서 연결됩니다.'])
      return !r
    })
  }

  return (
    <div className="flex h-dvh flex-col bg-slate-100 dark:bg-slate-950">
      {/* ── 상단 바 ── */}
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
        <Link to="/" className="btn-ghost px-2 py-1" aria-label="홈으로">←</Link>
        <div className="min-w-0">
          <div className="text-xs text-slate-500">
            {MODE_LABEL[params.mode]}{problem && ` · ${DIFFICULTIES[problem.difficulty].name}`}
          </div>
          <h1 className="truncate font-semibold">{template?.title ?? problem?.title}</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {problem && params.mode !== 'basics' && (
            <span role="timer" aria-label={remaining != null ? '남은 시간' : '경과 시간'}
              className={`chip font-mono text-sm ${lowTime ? 'animate-pulse bg-rose-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>
              ⏱ {fmtTime(remaining ?? elapsed)}
            </span>
          )}
          {template && <button type="button" className="btn-ghost py-1" onClick={() => setDrawer('about')}>📖 설명</button>}
          {problem && params.mode !== 'basics' && (
            <>
              {problem.showWiringGuide && <button type="button" className="btn-ghost py-1" onClick={() => setDrawer('guide')}>🔌 배선 가이드</button>}
              <button type="button" className="btn-ghost py-1" onClick={() => setDrawer('hint')}>💡 힌트{hintsOpened.size > 0 && ` (${hintsOpened.size})`}</button>
              <button type="button" className="btn-ghost py-1" disabled title="4단계에서 구현">🔍 검사하기</button>
              <button type="button" className="btn-primary py-1" onClick={submit}>제출</button>
            </>
          )}
          <ThemeToggle />
        </div>
      </header>

      {/* ── 문제 설명 + 추가 요구 카드 ── */}
      {problem && params.mode !== 'basics' && (
        <section aria-label="문제" className="border-b border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
          <button type="button" className="panel-title" aria-expanded={showStatement} onClick={() => setShowStatement((v) => !v)}>
            문제 {showStatement ? '▲' : '▼'}
          </button>
          {showStatement && (
            <div className="mt-1 flex flex-col gap-2 lg:flex-row">
              <div className="flex-1 space-y-0.5">
                {problem.statement.map((l) => <p key={l}>{l}</p>)}
              </div>
              {problem.cards.length > 0 && (
                <ul className="flex flex-wrap gap-2 lg:max-w-[50%]" aria-label="추가 요구 카드">
                  {problem.cards.map((c) => {
                    const t = cardText(problem, c)
                    return (
                      <li key={c.cardId} className="rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2 dark:bg-amber-950">
                        <div className="text-xs font-bold text-amber-700 dark:text-amber-300">🃏 추가 요구 #{t.number} · {t.title}</div>
                        <div className="text-xs">{t.description}</div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── 본문: 트레이 | 캔버스 | 에디터 ── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto p-2 lg:grid-cols-[180px_minmax(0,1fr)_minmax(340px,38%)] lg:overflow-hidden">
        <aside aria-label="부품 트레이" className="card p-2 lg:overflow-auto">
          <PartsTray problem={problem} />
        </aside>
        <section aria-label="회로" className="card relative flex min-h-72 flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
            <button type="button" onClick={toggleRun}
              className={`btn py-1 ${running ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
              {running ? '■ 정지' : '▶ 시작'}
            </button>
            <span className="text-xs text-slate-500">{running ? '실행 중' : '정지됨'}</span>
          </div>
          <div className="min-h-0 flex-1 bg-slate-50 dark:bg-slate-800/40"><CircuitCanvas /></div>
        </section>
        <section aria-label="코드" className="card flex min-h-80 flex-col overflow-hidden">
          <div className="flex items-center border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
            <span className="panel-title">sketch.ino</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto"><CodeEditor value={code} onChange={setCode} /></div>
        </section>
      </div>

      {/* ── 하단: 시리얼 모니터 | 가상 센서 ── */}
      <div className="grid shrink-0 gap-2 border-t border-slate-200 p-2 lg:h-56 lg:grid-cols-2 dark:border-slate-800">
        <section aria-label="시리얼 모니터" className="card flex min-h-0 flex-col p-2">
          <h2 className="panel-title mb-1">시리얼 모니터</h2>
          <div className="min-h-0 flex-1"><SerialMonitor lines={serial} onClear={() => setSerial([])} /></div>
        </section>
        <section aria-label="가상 센서 조작" className="card min-h-0 overflow-auto p-2">
          <h2 className="panel-title mb-1">가상 센서</h2>
          <SensorControls sensors={problem?.sensors ?? []} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
        </section>
      </div>

      {/* ── 오른쪽 서랍 (힌트 / 배선 가이드 / 템플릿 설명) ── */}
      {drawer && (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={() => setDrawer(null)}>
          <aside role="dialog" aria-modal="true" aria-label={drawer === 'hint' ? '힌트' : drawer === 'guide' ? '배선 가이드' : '설명'}
            className="h-full w-full max-w-md overflow-auto bg-white p-4 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{drawer === 'hint' ? '💡 힌트' : drawer === 'guide' ? '🔌 배선 가이드' : '📖 설명'}</h2>
              <button type="button" className="btn-ghost px-2 py-1" onClick={() => setDrawer(null)} aria-label="닫기" autoFocus>✕</button>
            </div>
            {drawer === 'hint' && problem && (
              <HintPanel problem={problem} opened={hintsOpened} locked={locked}
                onOpen={(k) => setHintsOpened((s) => new Set(s).add(k))} />
            )}
            {drawer === 'guide' && problem && <WiringGuide problem={problem} />}
            {drawer === 'about' && template && (
              <ul className="list-disc space-y-2 pl-5 text-sm">{template.explanation.map((e) => <li key={e}>{e}</li>)}</ul>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
