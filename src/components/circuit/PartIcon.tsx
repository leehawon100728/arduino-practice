import type { CircuitPartKind } from '../../sim/parts'

// 부품 트레이용 작은 아이콘 (이모지 대신 실제 모양에 가깝게)

const LED_FILL: Record<string, string> = { 'led-red': '#ef4444', 'led-green': '#22c55e', 'led-blue': '#3b82f6' }

function LedIcon({ kind }: { kind: CircuitPartKind }) {
  const fill = LED_FILL[kind]
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden>
      <line x1={7} y1={21} x2={7} y2={15} stroke="url(#leadGrad)" strokeWidth={1.6} />
      <line x1={17} y1={21} x2={17} y2={15} stroke="url(#leadGrad)" strokeWidth={1.6} />
      <circle cx={12} cy={10} r={9} fill={fill} opacity={0.3} filter="url(#glow)" />
      <path d="M4 10 L4 6 A8 8 0 0 1 20 6 L20 16 L4 16 Z" fill={fill} stroke="#7f1d1d" strokeWidth={1} />
      <path d="M6 8 A6 6 0 0 1 11 3" fill="none" stroke="#fff" strokeWidth={1.3} opacity={0.55} />
    </svg>
  )
}

// 세로(다리가 위아래로 꽂히는 방향)가 실제 기본 배치(rot=0)와 같다 — 트레이에서 돌리기 버튼을 누르면
// 이 세로 모양이 가로로 눕혀지고, 그게 그대로 브레드보드에 가로로 꽂힌다
function ResistorIcon({ kind }: { kind: CircuitPartKind }) {
  const bands = kind === 'res-220' ? ['#d6281f', '#d6281f', '#5a3a1a'] : ['#5a3a1a', '#1a1a1a', '#e8740c']
  return (
    <svg viewBox="0 0 16 36" width={12} height={26} aria-hidden>
      <line x1={8} y1={0} x2={8} y2={9} stroke="url(#leadGrad)" strokeWidth={2} />
      <line x1={8} y1={27} x2={8} y2={36} stroke="url(#leadGrad)" strokeWidth={2} />
      <rect x={2} y={9} width={12} height={18} rx={5} fill="url(#resistorBodyGrad)" stroke="#7c5a32" strokeWidth={0.7} />
      <rect x={2} y={9} width={12} height={3} fill="#fff" opacity={0.3} />
      {bands.map((c, i) => <rect key={i} x={2} y={13 + i * 4} width={12} height={2.4} fill={c} />)}
      <rect x={2} y={24} width={12} height={2.4} fill="#c9972e" />
    </svg>
  )
}

export default function PartIcon({ kind }: { kind: CircuitPartKind }) {
  if (kind.startsWith('led-')) return <LedIcon kind={kind} />
  if (kind.startsWith('res-')) return <ResistorIcon kind={kind} />
  return null
}
