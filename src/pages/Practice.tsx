import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { AttemptRecord, Problem, SensorId } from '../types'
import { DIFFICULTIES } from '../data/difficulty'
import { BASIC_TEMPLATES } from '../data/templates'
import { generateProblem, cardText } from '../lib/problem'
import { parsePracticeParams } from '../lib/route'
import { starterCode } from '../lib/starter'
import { fmtTime, useCountdown } from '../lib/useCountdown'
import { useSimulation } from '../lib/useSimulation'
import { addAttempt } from '../lib/storage'
import { readCircuitDraft, readDraft, saveResult, writeCircuitDraft, writeDraft } from '../lib/resultStore'
import { compileSource, type Diagnostic } from '../interp/compiler'
import { grade, type GradeReport } from '../grading/grade'
import { buildModelCircuit } from '../sim/modelCircuit'
import { PART_DEFS, emptyCircuit, type Circuit } from '../sim/parts'
import { defaultValues } from '../sim/board'
import CodeEditor, { type LineMark } from '../components/practice/CodeEditor'
import SensorControls from '../components/practice/SensorControls'
import SerialMonitor from '../components/practice/SerialMonitor'
import PartsTray from '../components/practice/PartsTray'
import WiringGuide from '../components/practice/WiringGuide'
import HintPanel from '../components/practice/HintPanel'
import CircuitEditor, { type CircuitEditorHandle } from '../components/circuit/CircuitEditor'
import ReportView from '../components/report/ReportView'
import SolutionPanel from '../components/report/SolutionPanel'
import ThemeToggle from '../components/ThemeToggle'
import { SENSOR_IDS } from '../data/sensors'

type Drawer = null | 'hint' | 'guide' | 'about' | 'solution' | 'report'

const MODE_LABEL = { basics: '기본기', single: '센서별 연습', combo: '조합 연습', exam: '실전 모드', review: '약점 복습' } as const

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
  const [code, setCode] = useState(() => readDraft(draftKey) ?? template?.code ?? (problem ? starterCode(problem) : ''))
  const [circuit, setCircuit] = useState<Circuit>(() => readCircuitDraft(draftKey) ?? emptyCircuit())
  useEffect(() => { writeDraft(draftKey, code) }, [draftKey, code])
  useEffect(() => { writeCircuitDraft(draftKey, circuit) }, [draftKey, circuit])

  const [values, setValues] = useState<Record<string, number>>(defaultValues)
  const [drawer, setDrawer] = useState<Drawer>(template ? 'about' : null)
  const [hintsOpened, setHintsOpened] = useState<Set<string>>(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [showStatement, setShowStatement] = useState(true)
  const [report, setReport] = useState<GradeReport | null>(null)
  const [busy, setBusy] = useState(false)
  const editorRef = useRef<CircuitEditorHandle>(null)

  const sim = useSimulation({ code, circuit, values, irActiveLow: problem?.irActiveLow ?? true })

  // 실시간 문법 검사 (입력 멈춘 뒤 0.4초)
  const [diag, setDiag] = useState<{ errors: Diagnostic[]; warnings: Diagnostic[] }>({ errors: [], warnings: [] })
  useEffect(() => {
    const t = setTimeout(() => {
      const c = compileSource(code)
      setDiag({ errors: c.errors, warnings: c.warnings })
    }, 400)
    return () => clearTimeout(t)
  }, [code])

  // 조작 패널에 보일 센서: 문제 센서 + 회로에 꽂은 센서
  const controlSensors = useMemo(() => {
    const set = new Set<SensorId>(problem?.sensors ?? [])
    for (const p of circuit.parts) { const s = PART_DEFS[p.kind].sensor; if (s) set.add(s) }
    return SENSOR_IDS.filter((s) => set.has(s))
  }, [problem, circuit])

  const isBasics = params?.mode === 'basics'
  const canSeeSolution = !!problem && !isBasics && problem.difficulty === 1 && !problem.lockSolutionUntilSubmit
  const canLoadModel = (!!problem && (problem.showWiringGuide || isBasics)) || (!!template && template.parts.length > 0)

  const runGrade = useCallback(() => {
    if (!problem) return null
    return grade({ problem, code, circuit, hintsUsed: hintsOpened.size })
  }, [problem, code, circuit, hintsOpened])

  const elapsedRef = useRef(0)
  const submit = useCallback(async () => {
    if (!problem || !params || busy) return
    setBusy(true)
    sim.stop()
    await new Promise((r) => setTimeout(r, 30))
    const r = runGrade()!
    setSubmitted(true)
    const rec: AttemptRecord = {
      id: `${Date.now()}`, date: new Date().toISOString(), mode: params.mode, difficulty: problem.difficulty, sensors: problem.sensors,
      cards: problem.cards.map((c) => c.cardId), score: r.score, wiring: r.sections.wiring.score, code: r.sections.code.score,
      behavior: r.sections.behavior.score, hintsUsed: hintsOpened.size, durationSec: elapsedRef.current, failedChecks: r.failedIds,
    }
    addAttempt(rec)
    saveResult({ params, report: r, code, circuit, hintsUsed: hintsOpened.size, durationSec: elapsedRef.current, date: rec.date })
    setBusy(false)
    nav('/result')
  }, [problem, params, busy, sim, runGrade, hintsOpened, code, circuit, nav])

  const check = async () => {
    if (!problem || busy) return
    setBusy(true)
    setDrawer('report')
    setReport(null)
    await new Promise((r) => setTimeout(r, 30))
    setReport(runGrade())
    setBusy(false)
  }

  const { elapsed, remaining } = useCountdown(isBasics ? null : problem?.timeLimitSec ?? null, !submitted && !!problem && !isBasics, submit)
  elapsedRef.current = elapsed

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const loadModelCircuit = () => {
    if (circuit.parts.length && !confirm('지금 회로를 지우고 모범 배선을 불러올까요?')) return
    if (problem) setCircuit(buildModelCircuit(problem))
    else if (template?.id === 'external-led') setCircuit(buildModelCircuit({ sensors: [], pins: {}, leds: [{ pin: 'D11', color: 'red' }] }))
  }
  const loadCode = (c: string) => {
    if (!confirm('에디터의 코드를 모범답안으로 바꿀까요?')) return
    setCode(c)
    setDrawer(null)
  }

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
  const marks: LineMark[] = [
    ...diag.warnings.map((w) => ({ line: w.line, kind: 'warn' as const })),
    ...diag.errors.map((e) => ({ line: e.line, kind: 'error' as const })),
    ...(sim.runtimeError ? [{ line: sim.runtimeError.line, kind: 'error' as const }] : []),
  ]
  const liveWarnings = sim.snapshot?.warnings ?? []
  const firstError = diag.errors[0] ?? sim.compileErrors[0]

  return (
    <div className="flex h-dvh flex-col bg-slate-100 dark:bg-slate-950">
      {/* ── 상단 바 ── */}
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
        <Link to="/" className="btn-ghost px-2 py-1" aria-label="홈으로">←</Link>
        <div className="min-w-0">
          <div className="text-xs text-slate-500">
            {MODE_LABEL[params.mode]}{problem && !isBasics && ` · ${DIFFICULTIES[problem.difficulty].name}`}
          </div>
          <h1 className="truncate font-semibold">{template?.title ?? problem?.title}</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {problem && !isBasics && (
            <span role="timer" aria-label={remaining != null ? '남은 시간' : '경과 시간'}
              className={`chip font-mono text-sm ${lowTime ? 'animate-pulse bg-rose-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>
              ⏱ {fmtTime(remaining ?? elapsed)}
            </span>
          )}
          {template && <button type="button" className="btn-ghost py-1" onClick={() => setDrawer('about')}>📖 설명</button>}
          {problem && !isBasics && (
            <>
              {problem.showWiringGuide && <button type="button" className="btn-ghost py-1" onClick={() => setDrawer('guide')}>🔌 배선 가이드</button>}
              <button type="button" className="btn-ghost py-1" onClick={() => setDrawer('hint')}>💡 힌트{hintsOpened.size > 0 && ` (${hintsOpened.size})`}</button>
              {canSeeSolution && <button type="button" className="btn-ghost py-1" onClick={() => setDrawer('solution')}>📘 모범답안</button>}
              {params.mode !== 'exam' && <button type="button" className="btn-ghost py-1" disabled={busy} onClick={check}>🔍 검사하기</button>}
              <button type="button" className="btn-primary py-1" disabled={busy} onClick={() => { if (confirm('제출하고 채점할까요?')) submit() }}>{busy ? '채점 중…' : '제출'}</button>
            </>
          )}
          <ThemeToggle />
        </div>
      </header>

      {/* ── 문제 설명 + 추가 요구 카드 ── */}
      {problem && !isBasics && (
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
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto p-2 lg:grid-cols-[150px_minmax(0,1fr)_minmax(340px,36%)] lg:overflow-hidden">
        <aside aria-label="부품 트레이" className="card p-2 lg:overflow-auto">
          <PartsTray sensors={problem?.sensors ?? []} editor={editorRef} />
        </aside>
        <section aria-label="회로" className="card relative flex min-h-[340px] flex-col overflow-hidden lg:min-h-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
            <button type="button" onClick={() => (sim.running ? sim.stop() : sim.start())}
              className={`btn py-1 ${sim.running ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
              {sim.running ? '■ 정지' : '▶ 시작'}
            </button>
            <span className="text-xs text-slate-500" aria-live="polite">
              {sim.running ? `실행 중 · ${(sim.virtualMs / 1000).toFixed(1)}초${sim.slow ? ' (느리게 실행 중)' : ''}` : sim.runtimeError ? '오류로 멈춤' : '정지됨'}
            </span>
            {canLoadModel && <button type="button" className="btn-ghost ml-auto px-2 py-0.5 text-xs" onClick={loadModelCircuit}>📐 {problem ? '모범 배선 불러오기' : '예시 배선'}</button>}
          </div>
          <div className="min-h-0 flex-1 bg-slate-50 dark:bg-slate-800/40">
            <CircuitEditor ref={editorRef} circuit={circuit} onChange={setCircuit} snapshot={sim.snapshot} running={sim.running}
              pressed={values['button.pressed'] === 1}
              onPressButton={(down) => setValues((v) => ({ ...v, 'button.pressed': down ? 1 : 0 }))} />
          </div>
          {(liveWarnings.length > 0 || sim.runtimeError) && (
            <ul className="max-h-24 overflow-auto border-t border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100" aria-live="polite">
              {sim.runtimeError && <li className="font-semibold text-rose-700 dark:text-rose-300">⛔ {sim.runtimeError.line}번째 줄: {sim.runtimeError.message}</li>}
              {liveWarnings.map((w) => <li key={w}>⚠️ {w}</li>)}
            </ul>
          )}
        </section>
        <section aria-label="코드" className="card flex min-h-80 flex-col overflow-hidden lg:min-h-0">
          <div className="flex items-center border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
            <span className="panel-title">sketch.ino</span>
            <span className="ml-auto text-xs text-slate-500">{diag.errors.length ? '❌ 문법 오류' : diag.warnings.length ? `⚠️ 경고 ${diag.warnings.length}` : '✓ 문법 OK'}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto"><CodeEditor value={code} onChange={setCode} marks={marks} /></div>
          {(firstError || diag.warnings.length > 0) && (
            <div className="max-h-28 overflow-auto border-t border-slate-200 px-3 py-1.5 text-xs dark:border-slate-800" role="status">
              {firstError && (
                <p className="text-rose-700 dark:text-rose-300">
                  <b>{firstError.line}번째 줄:</b> {firstError.message}{firstError.hint && <span className="text-slate-500"> — {firstError.hint}</span>}
                </p>
              )}
              {diag.warnings.slice(0, 3).map((w) => <p key={`${w.line}${w.message}`} className="text-amber-700 dark:text-amber-300">{w.line}번째 줄: {w.message}</p>)}
            </div>
          )}
        </section>
      </div>

      {/* ── 하단: 시리얼 모니터 | 가상 센서 ── */}
      <div className="grid shrink-0 gap-2 border-t border-slate-200 p-2 lg:h-52 lg:grid-cols-2 dark:border-slate-800">
        <section aria-label="시리얼 모니터" className="card flex min-h-40 flex-col p-2 lg:min-h-0">
          <h2 className="panel-title mb-1">시리얼 모니터</h2>
          <div className="min-h-0 flex-1"><SerialMonitor lines={sim.serial} onSend={sim.sendSerial} onClear={sim.clearSerial} /></div>
        </section>
        <section aria-label="가상 센서 조작" className="card min-h-0 overflow-auto p-2">
          <h2 className="panel-title mb-1">가상 센서</h2>
          <SensorControls sensors={controlSensors} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
        </section>
      </div>

      {/* ── 오른쪽 서랍 ── */}
      {drawer && (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={() => setDrawer(null)}>
          <aside role="dialog" aria-modal="true"
            aria-label={{ hint: '힌트', guide: '배선 가이드', about: '설명', solution: '모범답안', report: '검사 결과' }[drawer]}
            className="h-full w-full max-w-xl overflow-auto bg-white p-4 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{{ hint: '💡 힌트', guide: '🔌 배선 가이드', about: '📖 설명', solution: '📘 모범답안', report: '🔍 검사 결과' }[drawer]}</h2>
              <button type="button" className="btn-ghost px-2 py-1" onClick={() => setDrawer(null)} aria-label="닫기" autoFocus>✕</button>
            </div>
            {drawer === 'hint' && problem && (
              <HintPanel problem={problem} opened={hintsOpened} locked={locked} onOpen={(k) => setHintsOpened((s) => new Set(s).add(k))} />
            )}
            {drawer === 'guide' && problem && <WiringGuide problem={problem} />}
            {drawer === 'solution' && problem && <SolutionPanel problem={problem} onLoadCode={loadCode} onLoadCircuit={() => { loadModelCircuit(); setDrawer(null) }} />}
            {drawer === 'report' && (
              report ? (
                <>
                  <p className="mb-3 text-xs text-slate-500">검사하기는 기록에 남지 않아요. 다 됐으면 [제출] 을 누르세요.</p>
                  <ReportView report={report} />
                </>
              ) : <p className="text-sm text-slate-500" role="status">⏳ 센서 값을 바꿔 가며 실행해 보는 중…</p>
            )}
            {drawer === 'about' && template && (
              <div className="space-y-3 text-sm">
                <p>{template.summary}</p>
                <ul className="list-disc space-y-2 pl-5">{template.explanation.map((e) => <li key={e}>{e}</li>)}</ul>
                {template.parts.length > 0 && <p className="text-xs text-slate-500">필요한 부품을 왼쪽에서 꽂거나, 회로판 위의 [📐 예시 배선] 을 눌러 보세요.</p>}
                <p className="text-xs text-slate-500">회로판 위의 ▶ 시작을 누르면 코드가 실행돼요.</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
