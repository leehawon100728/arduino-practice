import type { RefObject } from 'react'
import type { SensorId } from '../../types'
import { getSensor, SENSOR_IDS } from '../../data/sensors'
import { SENSOR_PART, isLed, isResistor, type CircuitPartKind } from '../../sim/parts'
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

/** 끌어서 놓거나, 클릭(엔터)하면 빈 자리에 자동으로 꽂힌다 */
export default function PartsTray({ sensors, editor }: { sensors: SensorId[]; editor: RefObject<CircuitEditorHandle | null> }) {
  const sensorItems = (sensors.length ? sensors : SENSOR_IDS).filter((s) => s !== 'button')
  const others = sensors.length ? SENSOR_IDS.filter((s) => !sensors.includes(s) && s !== 'button') : []
  const item = (kind: CircuitPartKind, label: string, icon: string, highlight = false) => (
    <button
      key={kind}
      type="button"
      title={`${label} — 끌어서 브레드보드에 꽂거나 클릭하세요`}
      onPointerDown={(e) => { e.preventDefault(); editor.current?.beginDrag(kind, e.clientX, e.clientY) }}
      onClick={(e) => { if (e.detail === 0) editor.current?.autoPlace(kind) }}
      className={`card flex shrink-0 touch-none select-none items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:border-brand-500 active:cursor-grabbing ${highlight ? 'border-brand-500 ring-1 ring-brand-500/40' : ''}`}
    >
      <span aria-hidden className="flex w-5 shrink-0 items-center justify-center text-base">
        {isLed(kind) || isResistor(kind) ? <PartIcon kind={kind} /> : icon}
      </span>
      <span>{label}</span>
    </button>
  )
  return (
    <div className="flex flex-wrap gap-1.5 lg:flex-col lg:flex-nowrap">
      <h2 className="panel-title hidden lg:block">부품</h2>
      {sensorItems.map((s) => item(SENSOR_PART[s], getSensor(s).shortName === 'CDS' ? '조도(CDS)' : getSensor(s).shortName, getSensor(s).icon, sensors.includes(s)))}
      {COMMON.map((c) => item(c.kind, c.label, c.icon, c.kind === 'pushbutton' && sensors.includes('button')))}
      {others.length > 0 && (
        <details className="text-xs lg:mt-1">
          <summary className="cursor-pointer text-slate-500">다른 센서</summary>
          <div className="mt-1 flex flex-wrap gap-1.5 lg:flex-col">
            {others.map((s) => item(SENSOR_PART[s], getSensor(s).shortName, getSensor(s).icon))}
          </div>
        </details>
      )}
      <p className="hidden text-[11px] leading-snug text-slate-500 lg:block">
        점퍼선: 구멍/핀을 차례로 클릭<br />선택 후 R 회전 · Delete 삭제 · 방향키 이동
      </p>
    </div>
  )
}
