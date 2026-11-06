import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Difficulty } from '../types'
import { DIFFICULTIES } from '../data/difficulty'
import { ALL_COMBOS, mulberry32, newSeed, pick } from '../lib/problem'
import { practiceUrl } from '../lib/route'
import DifficultyPicker from '../components/DifficultyPicker'

export default function ExamSetup() {
  const nav = useNavigate()
  const [lv, setLv] = useState<Difficulty>(2)
  const [minutes, setMinutes] = useState(DIFFICULTIES[2].examMinutes)

  const changeLv = (d: Difficulty) => { setLv(d); setMinutes(DIFFICULTIES[d].examMinutes) }

  const start = () => {
    const seed = newSeed()
    const sensors = pick(mulberry32(seed ^ 0x5eed), ALL_COMBOS)
    nav(practiceUrl({ mode: 'exam', sensors: [...sensors], difficulty: lv, seed, timerMinutes: minutes }))
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">실전 모드</h1>
      <div className="card space-y-2 p-5 text-sm text-slate-600 dark:text-slate-400">
        <p>• 센서 7종 중 <b>랜덤 2개</b>가 출제되고 추가 요구 카드가 0~2장 붙어요.</p>
        <p>• 시간이 끝나면 자동으로 제출됩니다. 힌트와 모범답안은 <b>제출 후에만</b> 열려요.</p>
        <p>• 배선 가이드는 제공되지 않아요.</p>
      </div>
      <DifficultyPicker value={lv} onChange={changeLv} />
      <label className="flex items-center gap-3 text-sm">
        <span className="panel-title">제한 시간</span>
        <input type="number" min={5} max={120} step={5} value={minutes} onChange={(e) => setMinutes(Math.max(5, Math.min(120, Number(e.target.value) || 40)))}
          className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
        <span>분</span>
      </label>
      <button type="button" className="btn-primary px-6 py-3 text-base" onClick={start}>🎲 랜덤 출제하고 시작</button>
    </div>
  )
}
