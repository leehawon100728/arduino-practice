import type { CircuitPartKind } from '../../sim/parts'
import { PART_DEFS } from '../../sim/parts'

// 부품 그림 (로컬 좌표: 다리 0 이 (0,0), 1피치 = 20)
// 회전은 바깥 <g transform="rotate(...)"> 로 처리한다.

const LED_FILL: Record<string, string> = { 'led-red': '#ef4444', 'led-green': '#22c55e', 'led-blue': '#3b82f6' }

export interface PartVisualState {
  brightness?: number
  burnt?: boolean
  powered?: boolean
  pressed?: boolean
  reversed?: boolean
}

function Legs({ kind }: { kind: CircuitPartKind }) {
  return (
    <>
      {PART_DEFS[kind].legs.map((l) => (
        <circle key={l.id} cx={l.dx * 20} cy={l.dy * 20} r={3.2} fill="#9ca3af" stroke="#4b5563" strokeWidth={1} />
      ))}
    </>
  )
}

function Module({ kind, w, label, state, children }: { kind: CircuitPartKind; w: number; label: string; state: PartVisualState; children?: React.ReactNode }) {
  const legs = PART_DEFS[kind].legs
  const x0 = -9
  const x1 = (legs.length - 1) * 20 + 9
  const width = Math.max(w, x1 - x0)
  const cx = (x0 + x1) / 2
  return (
    <g>
      {legs.map((l) => (
        <line key={l.id} x1={l.dx * 20} y1={0} x2={l.dx * 20} y2={-12} stroke="#d1d5db" strokeWidth={2.5} />
      ))}
      <rect x={cx - width / 2} y={-58} width={width} height={46} rx={4} fill="#1e3a8a" stroke="#172554" />
      {children}
      <text x={cx} y={-46} textAnchor="middle" fontSize={8} fill="#e0e7ff" fontWeight={600}>{label}</text>
      {legs.map((l) => (
        <text key={l.id} x={l.dx * 20} y={-15} textAnchor="middle" fontSize={6.5} fill="#fde68a">{l.label}</text>
      ))}
      <circle cx={cx + width / 2 - 6} cy={-52} r={2.5} fill={state.powered ? '#4ade80' : '#334155'}>
        <title>{state.powered ? '전원 켜짐' : '전원 없음'}</title>
      </circle>
      <Legs kind={kind} />
    </g>
  )
}

export default function PartGraphic({ kind, state = {} }: { kind: CircuitPartKind; state?: PartVisualState }) {
  switch (kind) {
    case 'pir':
      return (
        <Module kind={kind} w={56} label="PIR" state={state}>
          <circle cx={20} cy={-30} r={13} fill="#f8fafc" stroke="#cbd5e1" />
          <path d="M10 -30 h20 M20 -40 v20" stroke="#e2e8f0" />
        </Module>
      )
    case 'dht11':
      return (
        <Module kind={kind} w={50} label="DHT11" state={state}>
          <rect x={6} y={-40} width={28} height={24} rx={2} fill="#38bdf8" />
          {[0, 1, 2].map((i) => <line key={i} x1={8} x2={32} y1={-34 + i * 7} y2={-34 + i * 7} stroke="#0c4a6e" strokeWidth={1.5} />)}
        </Module>
      )
    case 'ultrasonic':
      return (
        <Module kind={kind} w={96} label="HC-SR04" state={state}>
          <circle cx={6} cy={-30} r={13} fill="#cbd5e1" stroke="#64748b" strokeWidth={2} />
          <circle cx={54} cy={-30} r={13} fill="#cbd5e1" stroke="#64748b" strokeWidth={2} />
          <circle cx={6} cy={-30} r={6} fill="#475569" />
          <circle cx={54} cy={-30} r={6} fill="#475569" />
        </Module>
      )
    case 'line':
      return (
        <Module kind={kind} w={70} label="TCRT5000" state={state}>
          <rect x={20} y={-40} width={20} height={12} rx={2} fill="#111827" />
          <circle cx={26} cy={-34} r={3} fill="#60a5fa" />
          <circle cx={34} cy={-34} r={3} fill="#1f2937" stroke="#94a3b8" />
          <circle cx={6} cy={-32} r={4} fill="#3b82f6" stroke="#bfdbfe"><title>감도 조절 나사</title></circle>
        </Module>
      )
    case 'ir':
      return (
        <Module kind={kind} w={56} label="IR" state={state}>
          <circle cx={8} cy={-32} r={6} fill="#e5e7eb" />
          <circle cx={32} cy={-32} r={6} fill="#111827" />
          <circle cx={20} cy={-22} r={3.5} fill="#3b82f6" />
        </Module>
      )
    case 'cds':
      return (
        <g>
          <line x1={0} y1={0} x2={6} y2={-10} stroke="#d1d5db" strokeWidth={2} />
          <line x1={20} y1={0} x2={14} y2={-10} stroke="#d1d5db" strokeWidth={2} />
          <ellipse cx={10} cy={-18} rx={11} ry={9} fill="#fef3c7" stroke="#b45309" />
          <path d="M2 -18 q2 -6 4 0 t4 0 t4 0 t4 0" fill="none" stroke="#b91c1c" strokeWidth={1.5} />
          <Legs kind={kind} />
        </g>
      )
    case 'pushbutton':
      return (
        <g>
          <rect x={-7} y={6} width={54} height={48} rx={4} fill="#374151" stroke="#111827" />
          <circle cx={20} cy={30} r={13} fill={state.pressed ? '#991b1b' : '#dc2626'} stroke="#7f1d1d" strokeWidth={2} />
          <Legs kind={kind} />
        </g>
      )
    case 'res-220':
    case 'res-10k': {
      const bands = kind === 'res-220' ? ['#dc2626', '#dc2626', '#78350f'] : ['#78350f', '#111827', '#ea580c']
      return (
        <g>
          <line x1={0} y1={0} x2={0} y2={80} stroke="#d1d5db" strokeWidth={2} />
          <rect x={-6} y={20} width={12} height={40} rx={5} fill="#e7c9a0" stroke="#a16207" />
          {bands.map((c, i) => <rect key={i} x={-6} y={26 + i * 8} width={12} height={3} fill={c} />)}
          <rect x={-6} y={52} width={12} height={3} fill="#ca8a04" />
          <text x={9} y={44} fontSize={8} fill="currentColor" className="fill-slate-600 dark:fill-slate-300">{kind === 'res-220' ? '220Ω' : '10kΩ'}</text>
          <Legs kind={kind} />
        </g>
      )
    }
    default: {
      // LED
      const b = state.brightness ?? 0
      const fill = LED_FILL[kind]
      return (
        <g>
          <path d="M0 0 L0 -6 L4 -12" fill="none" stroke="#d1d5db" strokeWidth={2} />
          <line x1={20} y1={0} x2={16} y2={-12} stroke="#d1d5db" strokeWidth={2} />
          {b > 0 && !state.burnt && <circle cx={10} cy={-22} r={14 + b * 10} fill={fill} opacity={0.15 + b * 0.35} filter="url(#glow)" />}
          <path d="M1 -14 L1 -24 A9 9 0 0 1 19 -24 L19 -14 Z" fill={state.burnt ? '#57534e' : fill} opacity={state.burnt ? 1 : 0.45 + b * 0.55} stroke={state.burnt ? '#292524' : '#7f1d1d'} strokeWidth={1} />
          <rect x={-1} y={-15} width={22} height={3} fill={state.burnt ? '#44403c' : fill} />
          <text x={-6} y={-4} fontSize={9} fontWeight={700} fill="#dc2626">+</text>
          {state.burnt && <text x={10} y={-34} textAnchor="middle" fontSize={16}>💥</text>}
          <Legs kind={kind} />
        </g>
      )
    }
  }
}
