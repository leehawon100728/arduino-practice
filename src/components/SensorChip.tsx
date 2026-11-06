import type { SensorId } from '../types'
import { getSensor } from '../data/sensors'

export default function SensorChip({ id }: { id: SensorId }) {
  const s = getSensor(id)
  return (
    <span className="chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
      <span aria-hidden>{s.icon}</span>
      {s.shortName}
    </span>
  )
}
