import type { Problem } from '../types'
import { getSensor } from '../data/sensors'
import { pinLabel } from './problem'

/** 학생 에디터의 시작 코드: 핀 메모만 주석으로 주고 나머지는 직접 작성 */
export function starterCode(p: Problem): string {
  const lines = ['// ' + p.title, '// 핀 배정']
  for (const id of p.sensors) {
    const s = getSensor(id)
    for (const sig of s.signals) {
      lines.push(`//   ${s.shortName} ${sig.label}: ${pinLabel(p.pins[id]![sig.key])}${sig.required ? '' : ' (선택)'}`)
    }
  }
  p.leds.forEach((l, i) => lines.push(`//   LED${p.leds.length > 1 ? i + 1 : ''}: ${pinLabel(l.pin)}`))
  lines.push('', 'void setup() {', '  ', '}', '', 'void loop() {', '  ', '}', '')
  return lines.join('\n')
}
