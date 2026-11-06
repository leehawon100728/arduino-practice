import type { GradeReport, Section } from '../../grading/grade'

const SECTION_NAME: Record<Section, string> = { wiring: '🔌 배선 검사', code: '💻 코드 검사', behavior: '⚙️ 동작 검사' }

export function ScoreBadge({ score }: { score: number }) {
  const color = score >= 90 ? 'text-emerald-600' : score >= 70 ? 'text-amber-600' : 'text-rose-600'
  return <span className={`text-4xl font-extrabold tabular-nums ${color}`}>{score}<span className="text-lg text-slate-400">/100</span></span>
}

export default function ReportView({ report, compact = false }: { report: GradeReport; compact?: boolean }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-end gap-4">
        <ScoreBadge score={report.score} />
        {report.hintPenalty > 0 && <span className="chip bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200">힌트 −{report.hintPenalty}점</span>}
        <div className="grid flex-1 gap-1">
          {(['wiring', 'code', 'behavior'] as Section[]).map((s) => {
            const sec = report.sections[s]
            return (
              <div key={s} className="flex items-center gap-2">
                <span className="w-24 text-xs">{SECTION_NAME[s]}</span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-slate-200 dark:bg-slate-800" role="meter" aria-label={SECTION_NAME[s]} aria-valuenow={sec.score} aria-valuemax={sec.max}>
                  <div className={`h-full ${sec.score >= sec.max * 0.9 ? 'bg-emerald-500' : sec.score >= sec.max * 0.6 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${(sec.score / sec.max) * 100}%` }} />
                </div>
                <span className="w-14 text-right font-mono text-xs">{Math.round(sec.score)}/{sec.max}</span>
              </div>
            )
          })}
        </div>
      </div>

      {(['wiring', 'code', 'behavior'] as Section[]).map((s) => {
        const list = report.items.filter((i) => i.section === s)
        if (!list.length) return null
        return (
          <section key={s}>
            <h3 className="mb-1 font-semibold">{SECTION_NAME[s]} <span className="text-xs font-normal text-slate-500">{Math.round(report.sections[s].score)}/{report.sections[s].max}점</span></h3>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {list.map((i) => (
                <li key={i.id} className="flex gap-2 px-3 py-2">
                  <span aria-label={i.ok ? '통과' : '실패'}>{i.ok ? '✅' : '❌'}</span>
                  <div className="min-w-0">
                    <div className={i.ok ? '' : 'font-medium'}>{i.label}</div>
                    {!i.ok && i.message && <div className="whitespace-pre-line text-xs text-rose-700 dark:text-rose-300">{i.message}</div>}
                    {i.note && <div className="text-xs text-amber-700 dark:text-amber-300">💡 {i.note}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      {!compact && report.warnings.length > 0 && (
        <section>
          <h3 className="mb-1 font-semibold">⚠️ 참고 경고</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800 dark:text-amber-200">
            {report.warnings.slice(0, 12).map((w) => <li key={w}>{w}</li>)}
          </ul>
        </section>
      )}
      {!compact && report.serialSample && (
        <section>
          <h3 className="mb-1 font-semibold">시리얼 출력 예시</h3>
          <pre className="max-h-40 overflow-auto rounded bg-slate-900 p-2 font-mono text-xs text-emerald-300">{report.serialSample}</pre>
        </section>
      )}
    </div>
  )
}
