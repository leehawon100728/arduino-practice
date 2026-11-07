import { useState, type RefObject } from 'react'
import type { SensorId } from '../../types'
import { getSensor, SENSOR_IDS } from '../../data/sensors'
import { SENSOR_PART, isLed, isResistor, type CircuitPartKind, type Rot } from '../../sim/parts'
import type { CircuitEditorHandle } from '../circuit/CircuitEditor'
import PartIcon from '../circuit/PartIcon'

const COMMON: { kind: CircuitPartKind; label: string; icon: string }[] = [
  { kind: 'led-red', label: 'LED 빨강', icon: '🔴' },
  { kind: 'led-green', label: 'LED 초록', icon: '🟢' },
  { kind: 'led-blue', label: 'LED 파랑', icon: '🔵' },
  { kind: 'res-220', label: '저항 220Ω', icon: '▭' },
  { kind: 'res-10k', label: '저항 10kΩ', icon: '▭' },
  { kind: 'pushbutton', label: '푸시버튼', icon: '🔘' },
]

/** 끌어서 놓거나, 클릭(엔터)하면 빈 자리에 자동으로 꽂힌다. 카드 모서리의 ⟳ 로 세로/가로 방향을 미리 정할 수 있다 */
export default function PartsTray({ sensors, editor }: { sensors: SensorId[]; editor: RefObject<CircuitEditorHandle | null> }) {
  const [rotMap, setRotMap] = useState<Partial<Record<CircuitPartKind, Rot>>>({})
  const sensorItems = (sensors.length ? sensors : SENSOR_IDS).filter((s) => s !== 'button')
  const others = sensors.length ? SENSOR_IDS.filter((s) => !sensors.includes(s) && s !== 'button') : []

  const toggleRot = (kind: CircuitPartKind) => setRotMap((m) => ({ ...m, [kind]: m[kind] === 1 ? 0 : 1 }))

  const item = (kind: CircuitPartKind, label: string, icon: string, highlight = false) => {
    const rot = rotMap[kind] ?? 0
    return (
      <div key={kind} className="relative">
        <button
          type="button"
          title={`${label} — 끌어서 브레드보드에 꽂거나 클릭하세요 (${rot === 1 ? '가로' : '세로'} 방향)`}
          onPointerDown={(e) => { e.preventDefault(); editor.current?.beginDrag(kind, e.clientX, e.clientY, rot) }}
          onClick={(e) => { if (e.detail === 0) editor.current?.autoPlace(kind, rot) }}
          className={`card flex w-full touch-none select-none flex-col items-center justify-center gap-1 px-1 py-2 text-center text-[11px] leading-tight hover:border-brand-500 active:cursor-grabbing ${highlight ? 'border-brand-500 ring-1 ring-brand-500/40' : ''}`}
        >
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center text-xl transition-transform"
            style={rot === 1 ? { transform: 'rotate(90deg)' } : undefined}
          >
            {isLed(kind) || isResistor(kind) ? <PartIcon kind={kind} /> : icon}
          </span>
          <span>{label}</span>
        </button>
        <button
          type="button"
          title="가로/세로 방향 전환"
          aria-label={`${label} 가로/세로 방향 전환, 현재 ${rot === 1 ? '가로' : '세로'}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); toggleRot(kind) }}
          className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] leading-none text-slate-500 shadow-sm hover:border-brand-500 hover:text-brand-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          ⟳
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="panel-title hidden lg:block">부품</h2>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-2">
        {sensorItems.map((s) => item(SENSOR_PART[s], getSensor(s).shortName === 'CDS' ? '조도(CDS)' : getSensor(s).shortName, getSensor(s).icon, sensors.includes(s)))}
        {COMMON.map((c) => item(c.kind, c.label, c.icon, c.kind === 'pushbutton' && sensors.includes('button')))}
      </div>
      {others.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500">다른 센서</summary>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-2">
            {others.map((s) => item(SENSOR_PART[s], getSensor(s).shortName, getSensor(s).icon))}
          </div>
        </details>
      )}
      <p className="hidden text-[11px] leading-snug text-slate-500 lg:block">
        부품 오른쪽 위 ⟳ 로 가로/세로 방향을 미리 정할 수 있어요.<br />
        점퍼선: 구멍/핀을 차례로 클릭<br />선택 후 R 회전 · Delete 삭제 · 방향키 이동
      </p>
    </div>
  )
}
