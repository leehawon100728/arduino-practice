import type { Difficulty } from '../types'
import { DIFFICULTIES } from '../data/difficulty'

export default function DifficultyPicker({ value, onChange }: { value: Difficulty; onChange: (d: Difficulty) => void }) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-3">
      <legend className="panel-title mb-2">난이도</legend>
      {([1, 2, 3] as Difficulty[]).map((lv) => {
        const d = DIFFICULTIES[lv]
        const active = value === lv
        return (
          <label
            key={lv}
            className={`card cursor-pointer p-3 text-left transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 ${active ? 'border-brand-500 ring-1 ring-brand-500' : 'hover:border-slate-400'}`}
          >
            <input type="radio" name="difficulty" className="sr-only" checked={active} onChange={() => onChange(lv)} />
            <div className="font-semibold">{d.name}{lv === 3 && ' 🔥'}</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{d.tagline}</div>
          </label>
        )
      })}
    </fieldset>
  )
}
