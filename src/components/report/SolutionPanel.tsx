import { useMemo, useState } from 'react'
import type { Problem } from '../../types'
import { getSensor } from '../../data/sensors'
import { solutionVariants } from '../../lib/solution'
import { buildModelCircuit } from '../../sim/modelCircuit'
import CodeEditor from '../practice/CodeEditor'
import WiringGuide from '../practice/WiringGuide'
import CircuitEditor from '../circuit/CircuitEditor'

export default function SolutionPanel({ problem, onLoadCode, onLoadCircuit }: {
  problem: Problem
  onLoadCode?: (code: string) => void
  onLoadCircuit?: () => void
}) {
  const variants = useMemo(() => solutionVariants(problem), [problem])
  const [vid, setVid] = useState(variants[0].id)
  const [tab, setTab] = useState<'code' | 'wiring' | 'tips'>('code')
  const [copied, setCopied] = useState(false)
  const v = variants.find((x) => x.id === vid) ?? variants[0]
  const circuit = useMemo(() => buildModelCircuit({ ...problem, buttonMode: vid === 'button-alt0' ? 'pullup' : problem.buttonMode }), [problem, vid])

  const copy = async () => {
    try { await navigator.clipboard.writeText(v.code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* 무시 */ }
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div role="tablist" className="flex gap-1">
        {([['code', '💻 코드'], ['wiring', '🔌 배선'], ['tips', '⚠️ 자주 하는 실수']] as const).map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`btn py-1 ${tab === id ? 'bg-brand-600 text-white' : 'btn-ghost'}`}>{label}</button>
        ))}
      </div>

      {tab === 'code' && (
        <>
          {variants.length > 1 && (
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="답안 종류">
              {variants.map((x) => (
                <button key={x.id} type="button" role="radio" aria-checked={vid === x.id} onClick={() => setVid(x.id)}
                  className={`chip border ${vid === x.id ? 'border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-900 dark:text-brand-100' : 'border-slate-300 dark:border-slate-700'}`}>{x.title}</button>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500">{v.description}</p>
          <div className="h-[420px] overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <CodeEditor value={v.code} readOnly label="모범답안 코드" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" onClick={copy}>{copied ? '✓ 복사됨' : '📋 코드 복사'}</button>
            {onLoadCode && <button type="button" className="btn-primary" onClick={() => onLoadCode(v.code)}>📥 에디터에 불러오기</button>}
          </div>
        </>
      )}

      {tab === 'wiring' && (
        <>
          <div className="h-72 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40">
            <CircuitEditor circuit={circuit} readOnly />
          </div>
          {onLoadCircuit && <button type="button" className="btn-ghost self-start" onClick={onLoadCircuit}>📐 이 배선을 회로판에 불러오기</button>}
          <WiringGuide problem={vid === 'button-alt0' ? { ...problem, buttonMode: 'pullup' } : problem} />
        </>
      )}

      {tab === 'tips' && (
        <div className="space-y-4">
          {problem.sensors.map((id) => {
            const s = getSensor(id)
            return (
              <section key={id} className="space-y-2">
                <h3 className="font-semibold">{s.icon} {s.name}</h3>
                <div>
                  <div className="panel-title">자주 하는 실수 3가지</div>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5">{s.mistakes.map((m) => <li key={m}>{m}</li>)}</ol>
                </div>
                <div>
                  <div className="panel-title">시험에서 자주 틀리는 포인트</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">{s.examPitfalls.map((m) => <li key={m}>{m}</li>)}</ul>
                </div>
                <div>
                  <div className="panel-title">센서 설명</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-600 dark:text-slate-400">{s.notes.map((m) => <li key={m}>{m}</li>)}</ul>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
