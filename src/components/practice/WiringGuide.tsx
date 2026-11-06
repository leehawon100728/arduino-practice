import type { Problem } from '../../types'
import { getSensor, COMMON_WARNINGS } from '../../data/sensors'
import { ledWiringRows, wiringRows } from '../../lib/wiring'

export default function WiringGuide({ problem }: { problem: Problem }) {
  const groups = [
    ...problem.sensors.map((id) => ({ title: `${getSensor(id).icon} ${getSensor(id).name}`, rows: wiringRows(problem, id) })),
    { title: '💡 LED', rows: ledWiringRows(problem) },
  ]
  return (
    <div className="space-y-4 text-sm">
      {groups.map((g) => (
        <section key={g.title}>
          <h3 className="mb-1 font-semibold">{g.title}</h3>
          <table className="w-full text-left">
            <thead className="text-xs text-slate-500"><tr><th className="py-1">부품</th><th>부품 핀</th><th>아두이노</th></tr></thead>
            <tbody>
              {g.rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1">{r.part}</td><td>{r.from}</td>
                  <td className="font-mono">{r.to}{r.note && <span className="ml-1 font-sans text-xs text-slate-500">({r.note})</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <ul className="list-disc space-y-1 rounded-lg bg-amber-50 p-3 pl-7 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        {COMMON_WARNINGS.map((w) => <li key={w}>{w}</li>)}
      </ul>
    </div>
  )
}
