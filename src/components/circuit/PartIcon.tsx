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

function ResistorIcon({ kind }: { kind: CircuitPartKind }) {
  const bands = kind === 'res-220' ? ['#d6281f', '#d6281f', '#5a3a1a'] : ['#5a3a1a', '#1a1a1a', '#e8740c']
  return (
    <svg viewBox="0 0 36 16" width={30} height={14} aria-hidden>
      <line x1={0} y1={8} x2={9} y2={8} stroke="url(#leadGrad)" strokeWidth={2} />
      <line x1={27} y1={8} x2={36} y2={8} stroke="url(#leadGrad)" strokeWidth={2} />
      <rect x={9} y={2} width={18} height={12} rx={5} fill="url(#resistorBodyGrad)" stroke="#7c5a32" strokeWidth={0.7} />
      <rect x={9} y={2} width={3} height={12} fill="#fff" opacity={0.3} />
      {bands.map((c, i) => <rect key={i} x={13 + i * 4} y={2} width={2.4} height={12} fill={c} />)}
      <rect x={24} y={2} width={2.4} height={12} fill="#c9972e" />
    </svg>
  )
}

export default function PartIcon({ kind }: { kind: CircuitPartKind }) {
  if (kind.startsWith('led-')) return <LedIcon kind={kind} />
  if (kind.startsWith('res-')) return <ResistorIcon kind={kind} />
  return null
}
