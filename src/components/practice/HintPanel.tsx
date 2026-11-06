import { useState } from 'react'
import type { Problem, SensorId } from '../../types'
import { getSensor } from '../../data/sensors'

const LEVEL_NAMES = ['① 개념', '② 구조 / 의사코드', '③ 거의 정답']

/** 센서별 3단계 힌트. opened 는 "sensorId:level" 집합 (감점 계산용) */
export default function HintPanel({ problem, opened, onOpen, locked }: {
  problem: Problem; opened: Set<string>; onOpen: (key: string) => void; locked: boolean
}) {
  const [sensor, setSensor] = useState<SensorId>(problem.sensors[0])
  if (locked) return <p className="text-sm text-slate-500">🔒 실전 모드에서는 제출한 뒤에 힌트를 볼 수 있어요.</p>
  if (!problem.allowHints) return <p className="text-sm text-slate-500">🔥 Lv3 지옥 모드는 힌트가 없어요.</p>
  const s = getSensor(sensor)
  return (
    <div className="space-y-3 text-sm">
      {problem.hintPenalty > 0 && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200">
          힌트를 한 단계 열 때마다 {problem.hintPenalty}점 감점돼요. (지금까지 −{opened.size * problem.hintPenalty}점)
        </p>
      )}
      {problem.sensors.length > 1 && (
        <div className="flex gap-1" role="tablist">
          {problem.sensors.map((id) => (
            <button key={id} role="tab" aria-selected={sensor === id} type="button" onClick={() => setSensor(id)}
              className={`btn py-1 ${sensor === id ? 'bg-brand-600 text-white' : 'btn-ghost'}`}>{getSensor(id).shortName}</button>
          ))}
        </div>
      )}
      {s.hints.map((h, i) => {
        const key = `${sensor}:${i}`
        const isOpen = opened.has(key)
        const prevOpen = i === 0 || opened.has(`${sensor}:${i - 1}`)
        return (
          <div key={key} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{LEVEL_NAMES[i]}</span>
              {!isOpen && (
                <button type="button" className="btn-ghost py-1 text-xs" disabled={!prevOpen} onClick={() => onOpen(key)}>
                  {prevOpen ? '열기' : '앞 단계 먼저'}
                </button>
              )}
            </div>
            {isOpen && <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-slate-700 dark:text-slate-300">{h}</pre>}
          </div>
        )
      })}
    </div>
  )
}
