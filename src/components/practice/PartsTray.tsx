import type { Problem } from '../../types'
import { getSensor } from '../../data/sensors'

const COMMON_PARTS = [
  { id: 'led-red', label: 'LED (빨강)', icon: '🔴' },
  { id: 'led-green', label: 'LED (초록)', icon: '🟢' },
  { id: 'led-blue', label: 'LED (파랑)', icon: '🔵' },
  { id: 'res-220', label: '저항 220Ω', icon: '〰' },
  { id: 'res-10k', label: '저항 10kΩ', icon: '〰' },
  { id: 'pushbutton', label: '푸시버튼', icon: '🔘' },
]

// 2단계에서 드래그&드롭 배치를 연결한다.
export default function PartsTray({ problem }: { problem: Problem | null }) {
  const sensorParts = (problem?.sensors ?? []).map((id) => getSensor(id))
  return (
    <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
      <h2 className="panel-title hidden lg:block">부품</h2>
      {sensorParts.map((s) => (
        <div key={s.id} className="card flex shrink-0 items-center gap-2 border-brand-500 px-3 py-2 text-sm" title={s.model}>
          <span aria-hidden>{s.icon}</span>{s.shortName}
        </div>
      ))}
      {COMMON_PARTS.map((p) => (
        <div key={p.id} className="card flex shrink-0 items-center gap-2 px-3 py-2 text-sm">
          <span aria-hidden>{p.icon}</span>{p.label}
        </div>
      ))}
      <p className="hidden text-xs text-slate-500 lg:block">점퍼선: 핀을 차례로 클릭해 연결 (다음 단계에서 구현)</p>
    </div>
  )
}
