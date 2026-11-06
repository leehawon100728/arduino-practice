import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Difficulty } from '../types'
import { getSensor } from '../data/sensors'
import { DIFFICULTIES } from '../data/difficulty'
import { generateProblem, cardText, newSeed, mulberry32, pick, ALL_COMBOS } from '../lib/problem'
import { practiceUrl } from '../lib/route'
import { loadResult, writeCircuitDraft, writeDraft } from '../lib/resultStore'
import { composeSolution } from '../lib/solution'
import { buildModelCircuit } from '../sim/modelCircuit'
import { fmtTime } from '../lib/useCountdown'
import ReportView from '../components/report/ReportView'
import SolutionPanel from '../components/report/SolutionPanel'
import CodeEditor, { type LineMark } from '../components/practice/CodeEditor'
import CircuitEditor from '../components/circuit/CircuitEditor'

export default function Result() {
  const nav = useNavigate()
  const res = loadResult()
  const [tab, setTab] = useState<'report' | 'compare' | 'solution'>('report')
  const problem = useMemo(() => res && generateProblem({ ...res.params, timerMinutes: res.params.timerMinutes }), [res])

  if (!res || !problem) {
    return (
      <div className="card mx-auto max-w-2xl p-8 text-center">
        <h1 className="text-xl font-bold">채점 결과가 없어요</h1>
        <p className="mt-2 text-slate-500">문제를 풀고 [제출] 을 누르면 여기에 결과가 나와요.</p>
        <Link to="/" className="btn-primary mt-4">홈으로</Link>
      </div>
    )
  }
  const { report, params } = res
  const marks: LineMark[] = [
    ...report.readLines.map((line) => ({ line, kind: 'read' as const })),
    ...report.writeLines.map((line) => ({ line, kind: 'write' as const })),
    ...report.compileErrors.map((e) => ({ line: e.line, kind: 'error' as const })),
  ]
  const model = composeSolution(problem)

  const retry = (lv: Difficulty, fresh = false) => {
    const seed = fresh ? newSeed() : params.seed
    const p2 = { ...params, difficulty: lv, seed }
    if (params.mode === 'exam' && fresh) p2.sensors = [...pick(mulberry32(seed ^ 0x5eed), ALL_COMBOS)]
    nav(practiceUrl(p2))
  }
  const loadIntoEditor = (code: string) => {
    writeDraft(problem.key, code)
    nav(practiceUrl(params))
  }
  const loadModelWiring = () => {
    writeCircuitDraft(problem.key, buildModelCircuit(problem))
    nav(practiceUrl(params))
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <div className="text-xs text-slate-500">{DIFFICULTIES[problem.difficulty].name} · {fmtTime(res.durationSec)} 걸림{res.hintsUsed ? ` · 힌트 ${res.hintsUsed}번` : ''}</div>
          <h1 className="text-2xl font-bold">채점 결과: {problem.sensors.map((s) => `${getSensor(s).icon} ${getSensor(s).shortName}`).join(' + ')}</h1>
          {problem.cards.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {problem.cards.map((c) => <span key={c.cardId} className="chip bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">🃏 {cardText(problem, c).title}</span>)}
            </div>
          )}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={() => retry(problem.difficulty)}>↺ 다시 도전</button>
          {problem.difficulty < 3 && problem.sensors.length > 1 && (
            <button type="button" className="btn-primary" onClick={() => retry((problem.difficulty + 1) as Difficulty, true)}>⬆ Lv{problem.difficulty + 1} 로 다시</button>
          )}
          {params.mode === 'exam' && <button type="button" className="btn-primary" onClick={() => retry(problem.difficulty, true)}>🎲 새 문제</button>}
          <Link to="/" className="btn-ghost">홈</Link>
        </div>
      </header>

      <div role="tablist" className="flex gap-1">
        {([['report', '📋 채점 리포트'], ['compare', '↔ 내 답 vs 모범답안'], ['solution', '📘 모범답안 · 배선 · 실수']] as const).map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`btn ${tab === id ? 'bg-brand-600 text-white' : 'btn-ghost'}`}>{label}</button>
        ))}
      </div>

      {tab === 'report' && <div className="card p-5"><ReportView report={report} /></div>}

      {tab === 'compare' && (
        <div className="space-y-4">
          <p className="flex flex-wrap gap-3 text-xs">
            <span><span className="inline-block size-3 rounded bg-blue-500/30 align-middle" /> 센서 읽기 줄</span>
            <span><span className="inline-block size-3 rounded bg-amber-500/40 align-middle" /> LED 출력 줄</span>
            <span><span className="inline-block size-3 rounded bg-rose-500/30 align-middle" /> 오류 줄</span>
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card flex flex-col overflow-hidden">
              <h2 className="border-b border-slate-200 px-3 py-2 font-semibold dark:border-slate-800">내 코드 <span className="text-sm font-normal text-slate-500">{report.score}점</span></h2>
              <div className="h-[480px]"><CodeEditor value={res.code} readOnly marks={marks} label="내 코드" /></div>
            </section>
            <section className="card flex flex-col overflow-hidden">
              <h2 className="flex items-center border-b border-slate-200 px-3 py-2 font-semibold dark:border-slate-800">모범답안
                <button type="button" className="btn-ghost ml-auto px-2 py-0.5 text-xs" onClick={() => loadIntoEditor(model)}>📥 에디터에 불러오기</button>
              </h2>
              <div className="h-[480px]"><CodeEditor value={model} readOnly label="모범답안" /></div>
            </section>
            <section className="card flex flex-col overflow-hidden">
              <h2 className="border-b border-slate-200 px-3 py-2 font-semibold dark:border-slate-800">내 배선</h2>
              <div className="h-72 bg-slate-50 dark:bg-slate-800/40"><CircuitEditor circuit={res.circuit} readOnly /></div>
            </section>
            <section className="card flex flex-col overflow-hidden">
              <h2 className="flex items-center border-b border-slate-200 px-3 py-2 font-semibold dark:border-slate-800">모범 배선
                <button type="button" className="btn-ghost ml-auto px-2 py-0.5 text-xs" onClick={loadModelWiring}>📐 회로판에 불러오기</button>
              </h2>
              <div className="h-72 bg-slate-50 dark:bg-slate-800/40"><CircuitEditor circuit={buildModelCircuit(problem)} readOnly /></div>
            </section>
          </div>
        </div>
      )}

      {tab === 'solution' && (
        <div className="card p-5"><SolutionPanel problem={problem} onLoadCode={loadIntoEditor} onLoadCircuit={loadModelWiring} /></div>
      )}
    </div>
  )
}
