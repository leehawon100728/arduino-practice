import type { SensorId } from '../../types'
import { getSensor } from '../../data/sensors'

export type SensorValues = Record<string, number> // "sensorId.controlKey" → 값

export function defaultSensorValues(ids: SensorId[]): SensorValues {
  const v: SensorValues = {}
  for (const id of ids) for (const c of getSensor(id).controls) v[`${id}.${c.key}`] = c.default
  return v
}

export default function SensorControls({ sensors, values, onChange }: {
  sensors: SensorId[]; values: SensorValues; onChange: (key: string, v: number) => void
}) {
  if (sensors.length === 0) return <p className="text-sm text-slate-500">조작할 센서가 없어요.</p>
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {sensors.map((id) => {
        const s = getSensor(id)
        return (
          <fieldset key={id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <legend className="px-1 text-sm font-semibold">{s.icon} {s.shortName}</legend>
            <div className="space-y-2">
              {s.controls.map((c) => {
                const key = `${id}.${c.key}`
                const val = values[key] ?? c.default
                const inputId = `ctl-${key}`
                if (c.type === 'slider') {
                  return (
                    <div key={key}>
                      <label htmlFor={inputId} className="flex justify-between text-xs">
                        <span>{c.label}</span>
                        <span className="font-mono font-semibold">{val}{c.unit}</span>
                      </label>
                      <input id={inputId} type="range" min={c.min} max={c.max} step={c.step} value={val}
                        onChange={(e) => onChange(key, Number(e.target.value))} className="w-full accent-brand-600" />
                    </div>
                  )
                }
                const on = val === 1
                const label = on ? c.onLabel : c.offLabel
                if (c.type === 'momentary') {
                  // 누르고 있는 동안만 ON (마우스, 터치, 키보드 스페이스 모두 지원)
                  return (
                    <button key={key} type="button" aria-pressed={on}
                      onPointerDown={() => onChange(key, 1)} onPointerUp={() => onChange(key, 0)} onPointerLeave={() => on && onChange(key, 0)}
                      onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); onChange(key, 1) } }}
                      onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') onChange(key, 0) }}
                      className={`btn w-full select-none touch-none ${on ? 'bg-brand-600 text-white' : 'btn-ghost'}`}>
                      {c.label}: {label} <span className="text-xs opacity-70">(누르고 있기)</span>
                    </button>
                  )
                }
                return (
                  <button key={key} type="button" role="switch" aria-checked={on} onClick={() => onChange(key, on ? 0 : 1)}
                    className={`btn w-full ${on ? 'bg-amber-500 text-white' : 'btn-ghost'}`}>
                    {c.label}: {label}
                  </button>
                )
              })}
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}
