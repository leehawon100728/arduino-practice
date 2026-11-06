import { it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Practice from './Practice'
import Home from './Home'
import Result from './Result'
import { saveResult } from '../lib/resultStore'
import { generateProblem } from '../lib/problem'
import { composeSolution } from '../lib/solution'
import { buildModelCircuit } from '../sim/modelCircuit'
import { grade } from '../grading/grade'

const urls = [
  '/practice?mode=single&lv=1&seed=1&s=ultrasonic',
  '/practice?mode=combo&lv=2&seed=5&s=pir,cds',
  '/practice?mode=exam&lv=3&seed=99&s=dht11,button&t=30',
  '/practice?mode=basics&lv=1&seed=1&tpl=blink',
  '/practice?mode=basics&lv=1&seed=1&tpl=external-led',
  '/practice?mode=basics&lv=1&seed=1&s=dht11&tpl=dht11-serial',
]
for (const u of urls) it(u, () => {
  const html = renderToString(createElement(MemoryRouter, { initialEntries: [u] }, createElement(Routes, null, createElement(Route, { path: '/practice', element: createElement(Practice) }))))
  expect(html).toContain('sketch.ino')
  expect(html).toContain('ATmega328P')
})
it('result', () => {
  const params = { mode: 'combo' as const, sensors: ['ultrasonic', 'cds'] as ('ultrasonic' | 'cds')[], difficulty: 2 as const, seed: 4 }
  const p = generateProblem(params)
  const code = composeSolution(p)
  const circuit = buildModelCircuit(p)
  saveResult({ params, report: grade({ problem: p, code, circuit }), code, circuit, hintsUsed: 0, durationSec: 60, date: '' })
  const html = renderToString(createElement(MemoryRouter, { initialEntries: ['/result'] }, createElement(Result)))
  expect(html).toContain('100')
  expect(html).toContain('배선 검사')
})
it('home', () => {
  expect(renderToString(createElement(MemoryRouter, null, createElement(Home)))).toContain('최근 기록')
})
