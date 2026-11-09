import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Circuit, CircuitPartKind, PlacedPart, Rot } from '../../sim/parts'
import { Netlist, PART_DEFS, canPlace, canPlaceLeg, isLed, isResistor, legHoles, rotate } from '../../sim/parts'
import {
  ARDUINO_PINS, BB, BB_COLS, PITCH, RAIL_ROWS, BOT_ROWS, TOP_ROWS, ROW_LETTER, RAIL_SIGN, UNO, VIEW,
  holeId, holeNode, holeXY, isHole, nearestHole, pointName, pointNode, pointXY,
} from '../../sim/geometry'
import { WIRE_COLORS } from '../../sim/modelCircuit'
import type { BoardSnapshot } from '../../sim/board'
import PartGraphic from './PartGraphic'

export interface CircuitEditorHandle {
  beginDrag: (kind: CircuitPartKind, clientX: number, clientY: number, rot?: Rot) => void
  autoPlace: (kind: CircuitPartKind, rot?: Rot) => void
}

interface Props {
  circuit: Circuit
  onChange?: (c: Circuit) => void
  snapshot?: BoardSnapshot | null
  running?: boolean
  readOnly?: boolean
  onPressButton?: (down: boolean) => void
  pressed?: boolean
  onLoadModel?: () => void
}

type Sel = { type: 'part' | 'wire'; id: string } | null
interface Drag { partId: string | null; kind: CircuitPartKind; rot: Rot; col: number; y: number; offCol: number; offY: number; moved: boolean; startX: number; startY: number }
interface LegDrag { partId: string; legId: string; x: number; y: number; defaultCol: number; defaultY: number }

/** 다리를 구부려서 꽂을 수 있는 최대 거리 (피치 단위). LED는 "2~3칸", 저항은 실제처럼 리드선을 길게 늘여 어디든 꽂을 수 있게 제한을 두지 않는다 */
const MAX_LEG_BEND_LED = 3.2
const maxLegBend = (kind: CircuitPartKind) => (isResistor(kind) ? Infinity : MAX_LEG_BEND_LED)

/** 부품의 각 다리를 (로컬 픽셀 좌표)로 변환 — 구부린 다리는 본체에서 멀어진 위치로 */
function legPosFor(p: PlacedPart) {
  const inv = ((4 - p.rot) % 4) as Rot
  const m: Record<string, { x: number; y: number }> = {}
  for (const h of legHoles(p)) {
    const [ldx, ldy] = rotate(h.col - p.col, h.y - p.y, inv)
    m[h.leg.id] = { x: ldx * 20, y: ldy * 20 }
  }
  return m
}

const ALL_HOLES: { col: number; y: number }[] = []
for (let c = 1; c <= BB_COLS; c++) for (const y of [...RAIL_ROWS, ...TOP_ROWS, ...BOT_ROWS]) ALL_HOLES.push({ col: c, y })

const PREFERRED_ROW: Record<CircuitPartKind, number[]> = {
  pir: [3], dht11: [3], ultrasonic: [3], line: [3], pot: [3], cds: [3], pushbutton: [7],
  'led-red': [12, 5], 'led-green': [12, 5], 'led-blue': [12, 5], 'res-220': [7], 'res-10k': [7, 3],
}

let uid = 0
const newId = (p: string) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`

const wireHex = (c: string) => WIRE_COLORS.find((w) => w.id === c)?.hex ?? c

function wirePath(a: { x: number; y: number }, b: { x: number; y: number }) {
  const d = Math.hypot(b.x - a.x, b.y - a.y)
  const sag = Math.min(40, d * 0.18)
  return `M${a.x} ${a.y} C${a.x} ${a.y + sag} ${b.x} ${b.y + sag} ${b.x} ${b.y}`
}

const CircuitEditor = forwardRef<CircuitEditorHandle, Props>(function CircuitEditor(
  { circuit, onChange, snapshot, running, readOnly, onPressButton, pressed, onLoadModel }, ref,
) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [sel, setSel] = useState<Sel>(null)
  const [wireStart, setWireStart] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [legDrag, setLegDrag] = useState<LegDrag | null>(null)
  const [color, setColor] = useState('orange')
  const [msg, setMsg] = useState<string | null>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag
  const legDragRef = useRef<LegDrag | null>(null)
  legDragRef.current = legDrag
  const partDown = useRef(false)

  const netlist = useMemo(() => new Netlist(circuit), [circuit])
  const occupied = useMemo(() => {
    const s = new Set<string>()
    for (const p of circuit.parts) for (const h of legHoles(p)) s.add(holeId(h.col, h.y))
    for (const w of circuit.wires) { if (w.a.startsWith('H:')) s.add(w.a); if (w.b.startsWith('H:')) s.add(w.b) }
    return s
  }, [circuit])

  const highlight = useMemo(() => {
    if (!hover) return null
    const root = netlist.find(pointNode(hover))
    const holes = new Set<string>()
    for (const h of ALL_HOLES) if (netlist.find(holeNode(h.col, h.y)) === root) holes.add(holeId(h.col, h.y))
    const pins = new Set(ARDUINO_PINS.filter((p) => netlist.find(p.node) === root).map((p) => p.id))
    return { holes, pins }
  }, [hover, netlist])

  const toSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return null
    const m = svg.getScreenCTM()
    if (!m) return null
    const pt = new DOMPoint(clientX, clientY).matrixTransform(m.inverse())
    return { x: pt.x, y: pt.y }
  }, [])

  // 화면에 실제로 그려지는 크기(화면 px / svg 단위)에 맞춰 터치 허용 오차를 넓힌다 —
  // 작은 화면에서는 svg 가 많이 축소돼 표시되므로, 고정된 svg 단위 오차만으로는 손가락 터치가 잘 안 먹는다
  const hitTolerance = useCallback(() => {
    const scale = svgRef.current?.getScreenCTM()?.a || 1
    return Math.max(8, Math.min(24, 16 / scale))
  }, [])

  const pointAt = useCallback((x: number, y: number): string | null => {
    const tol = hitTolerance()
    for (const p of ARDUINO_PINS) if (Math.abs(p.x - x) <= tol * 0.9 && Math.abs(p.y - y) <= tol * 1.15) return `P:${p.id}`
    const col = Math.round((x - BB.x - 30) / PITCH) + 1
    const row = Math.round((y - BB.y - 25) / PITCH)
    if (!isHole(col, row)) return null
    const h = holeXY(col, row)
    return Math.hypot(h.x - x, h.y - y) <= tol ? holeId(col, row) : null
  }, [hitTolerance])

  const change = (c: Circuit) => onChange?.(c)
  const flash = (m: string) => { setMsg(m); window.setTimeout(() => setMsg((x) => (x === m ? null : x)), 2500) }

  // ── 점퍼선 ──
  const clickPoint = (pid: string) => {
    if (readOnly) return
    if (pid.startsWith('H:') && occupied.has(pid) && !wireStart) {
      // 이미 선이 꽂혀 있는 구멍을 다시 터치하면: 그 선을 떼어내고 바로 이어서 새로 연결할 수 있게 한다
      const wire = circuit.wires.find((w) => w.a === pid || w.b === pid)
      if (wire) {
        change({ ...circuit, wires: circuit.wires.filter((w) => w.id !== wire.id) })
        setSel(null)
        setWireStart(pid)
        flash('기존 선을 뗐어요. 다른 구멍을 터치해 다시 연결하세요. (Esc: 취소)')
        return
      }
      // 부품 다리가 꽂힌 구멍은 같은 줄의 다른 빈 구멍으로 선을 뺄 수 있게 안내
      flash('이미 부품 다리가 꽂힌 구멍이에요. 같은 줄의 빈 구멍을 터치하세요.')
      return
    }
    if (!wireStart) { setWireStart(pid); setSel(null); return }
    if (wireStart === pid) { setWireStart(null); return }
    if (pid.startsWith('H:') && occupied.has(pid)) { flash('이미 무언가 꽂힌 구멍이에요.'); return }
    change({ ...circuit, wires: [...circuit.wires, { id: newId('w'), a: wireStart, b: pid, color }] })
    setWireStart(null)
  }

  // ── 부품 배치 ──
  const commitDrag = (d: Drag) => {
    const cand = { kind: d.kind, col: d.col, y: d.y, rot: d.rot }
    if (!canPlace(circuit, cand, d.partId ?? undefined)) {
      flash('그 자리에는 꽂을 수 없어요. 다리가 모두 빈 구멍에 들어가야 해요.')
      return
    }
    if (d.partId) {
      // 부품 전체를 옮기면 구부린 다리는 다시 곧게 편다
      change({ ...circuit, parts: circuit.parts.map((p) => (p.id === d.partId ? { ...p, col: d.col, y: d.y, bend: undefined } : p)) })
      setSel({ type: 'part', id: d.partId })
    } else {
      const id = newId('p')
      change({ ...circuit, parts: [...circuit.parts, { id, ...cand }] })
      setSel({ type: 'part', id })
    }
  }

  const autoPlace = (kind: CircuitPartKind, rot: Rot = 0) => {
    for (const y of PREFERRED_ROW[kind]) {
      for (let col = 1; col <= BB_COLS; col++) {
        const cand = { kind, col, y, rot }
        if (canPlace(circuit, cand)) {
          const id = newId('p')
          change({ ...circuit, parts: [...circuit.parts, { id, ...cand }] })
          setSel({ type: 'part', id })
          svgRef.current?.focus()
          return
        }
      }
    }
    flash('빈 자리가 없어요.')
  }

  useImperativeHandle(ref, () => ({
    beginDrag(kind, clientX, clientY, rot = 0) {
      if (readOnly) return
      const p = toSvg(clientX, clientY)
      const col = p ? Math.round((p.x - BB.x - 30) / PITCH) + 1 : 1
      const y = p ? Math.round((p.y - BB.y - 25) / PITCH) : 3
      setDrag({ partId: null, kind, rot, col, y, offCol: 0, offY: 0, moved: false, startX: clientX, startY: clientY })
    },
    autoPlace,
  }))

  // 드래그 중에는 창 전체에서 포인터를 추적 (트레이에서 끌어올 때도 동작)
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const p = toSvg(e.clientX, e.clientY)
      if (!p) return
      const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6
      const col = Math.round((p.x - BB.x - 30) / PITCH) + 1 - d.offCol
      const y = Math.round((p.y - BB.y - 25) / PITCH) - d.offY
      setDrag({ ...d, col, y, moved })
    }
    const up = () => {
      const d = dragRef.current
      setDrag(null)
      if (!d) return
      if (d.moved) commitDrag(d)
      else if (d.partId) setSel({ type: 'part', id: d.partId })
      else autoPlace(d.kind, d.rot) // 트레이에서 그냥 클릭하면 빈 자리에 자동 배치
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, circuit])

  const startPartDrag = (e: React.PointerEvent, part: PlacedPart) => {
    e.stopPropagation()
    if (readOnly) return
    partDown.current = true
    if (part.kind === 'pushbutton' && running) {
      onPressButton?.(true)
      const release = () => { onPressButton?.(false); window.removeEventListener('pointerup', release) }
      window.addEventListener('pointerup', release)
      return
    }
    const p = toSvg(e.clientX, e.clientY)
    if (!p) return
    const col = Math.round((p.x - BB.x - 30) / PITCH) + 1
    const y = Math.round((p.y - BB.y - 25) / PITCH)
    setWireStart(null)
    setDrag({ partId: part.id, kind: part.kind, rot: part.rot, col: part.col, y: part.y, offCol: col - part.col, offY: y - part.y, moved: false, startX: e.clientX, startY: e.clientY })
  }

  // ── LED 다리 구부리기 (몸통은 그대로 두고 다리 끝만 주변 구멍으로 옮긴다) ──
  const startLegDrag = (e: React.PointerEvent, part: PlacedPart, legId: string) => {
    e.stopPropagation()
    if (readOnly) return
    const def = PART_DEFS[part.kind].legs.find((l) => l.id === legId)
    const p = toSvg(e.clientX, e.clientY)
    if (!def || !p) return
    const [ddx, ddy] = rotate(def.dx, def.dy, part.rot)
    setWireStart(null)
    setSel({ type: 'part', id: part.id })
    setLegDrag({ partId: part.id, legId, x: p.x, y: p.y, defaultCol: part.col + ddx, defaultY: part.y + ddy })
  }

  useEffect(() => {
    if (!legDrag) return
    const move = (e: PointerEvent) => {
      const d = legDragRef.current
      if (!d) return
      const p = toSvg(e.clientX, e.clientY)
      if (!p) return
      setLegDrag({ ...d, x: p.x, y: p.y })
    }
    const up = () => {
      const d = legDragRef.current
      setLegDrag(null)
      if (!d) return
      const hole = nearestHole(d.x, d.y, Math.max(PITCH * 0.7, hitTolerance()))
      if (!hole) { flash('구멍 위에서 손을 놓아야 다리를 꽂을 수 있어요.'); return }
      const part0 = circuit.parts.find((x) => x.id === d.partId)
      if (!part0) return
      if (Math.hypot(hole.col - d.defaultCol, hole.y - d.defaultY) > maxLegBend(part0.kind)) {
        flash('다리를 그렇게 멀리 구부릴 수는 없어요. 원래 자리에서 2~3칸 안쪽으로만 옮기세요.')
        return
      }
      if (!canPlaceLeg(circuit, d.partId, d.legId, hole.col, hole.y)) { flash('그 구멍엔 이미 다른 다리나 선이 꽂혀 있어요.'); return }
      const isDefault = hole.col === d.defaultCol && hole.y === d.defaultY
      const bend = { ...part0.bend }
      if (isDefault) delete bend[d.legId]
      else bend[d.legId] = { col: hole.col, y: hole.y }
      change({ ...circuit, parts: circuit.parts.map((x) => (x.id === d.partId ? { ...x, bend } : x)) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legDrag !== null, circuit])

  // ── 키보드 ──
  const removeSel = () => {
    if (!sel) return
    if (sel.type === 'part') {
      // 부품을 지울 때 그 다리에 꽂혀 있던 점퍼선도 같이 지운다 (안 지우면 선이 그 자리에 그대로 남아
      // 마치 부품이 안 지워진 것처럼 구멍을 계속 막고 있게 된다)
      const part = circuit.parts.find((p) => p.id === sel.id)
      const legIds = part ? new Set(legHoles(part).map((h) => holeId(h.col, h.y))) : new Set<string>()
      change({
        ...circuit,
        parts: circuit.parts.filter((p) => p.id !== sel.id),
        wires: circuit.wires.filter((w) => !legIds.has(w.a) && !legIds.has(w.b)),
      })
    } else {
      change({ ...circuit, wires: circuit.wires.filter((w) => w.id !== sel.id) })
    }
    setSel(null)
  }
  const rotateSel = () => {
    if (sel?.type !== 'part') return
    const p = circuit.parts.find((x) => x.id === sel.id)
    if (!p) return
    for (let k = 1; k <= 3; k++) {
      const rot = ((p.rot + k) % 4) as Rot
      if (canPlace(circuit, { ...p, rot, bend: undefined }, p.id)) {
        change({ ...circuit, parts: circuit.parts.map((x) => (x.id === p.id ? { ...x, rot, bend: undefined } : x)) })
        return
      }
    }
    flash('회전할 공간이 없어요.')
  }
  const moveSel = (dc: number, dy: number) => {
    if (sel?.type !== 'part') return
    const p = circuit.parts.find((x) => x.id === sel.id)
    if (!p) return
    // 세로 이동은 다음 구멍 줄까지 건너뛴다
    for (let step = 1; step <= 4; step++) {
      const cand = { ...p, col: p.col + dc * step, y: p.y + dy * step, bend: undefined }
      if (canPlace(circuit, cand, p.id)) {
        change({ ...circuit, parts: circuit.parts.map((x) => (x.id === p.id ? cand : x)) })
        return
      }
      if (dc !== 0) break
    }
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (readOnly) return
    if (e.key === 'Escape') { setWireStart(null); setSel(null) }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel() }
    else if (e.key === 'r' || e.key === 'R') rotateSel()
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      moveSel(e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0)
    }
  }

  const onSvgPointerMove = (e: React.PointerEvent) => {
    const p = toSvg(e.clientX, e.clientY)
    if (!p) return
    setMouse(p)
    setHover(pointAt(p.x, p.y))
  }
  const onSvgPointerUp = (e: React.PointerEvent) => {
    if (partDown.current) { partDown.current = false; return }
    if (drag || legDrag) return
    const p = toSvg(e.clientX, e.clientY)
    if (!p) return
    const pid = pointAt(p.x, p.y)
    if (pid) clickPoint(pid)
    else { setSel(null); setWireStart(null) }
  }

  // ── 렌더링 ──
  const ghostValid = drag ? canPlace(circuit, { kind: drag.kind, col: drag.col, y: drag.y, rot: drag.rot }, drag.partId ?? undefined) : false
  const partState = (p: PlacedPart) => ({
    brightness: snapshot?.leds[p.id]?.brightness ?? 0,
    burnt: snapshot?.leds[p.id]?.burnt,
    powered: snapshot?.modules[p.id]?.powered,
    pressed: p.kind === 'pushbutton' ? pressed : false,
  })
  const anchor = (p: { col: number; y: number }) => holeXY(p.col, p.y)

  return (
    <div className="flex h-full flex-col">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 px-2 py-1 text-xs dark:border-slate-800">
          <span className="text-slate-500">선 색</span>
          <div role="radiogroup" aria-label="점퍼선 색" className="flex gap-1">
            {WIRE_COLORS.map((w) => (
              <button key={w.id} type="button" role="radio" aria-checked={color === w.id} aria-label={w.label} title={w.label}
                onClick={() => setColor(w.id)}
                className={`size-5 rounded-full border-2 ${color === w.id ? 'border-brand-500 ring-2 ring-brand-500/40' : 'border-slate-300 dark:border-slate-600'}`}
                style={{ background: w.hex }} />
            ))}
          </div>
          <span className="mx-1 h-4 w-px bg-slate-300 dark:bg-slate-700" />
          <button type="button" className="btn-ghost px-2 py-0.5 text-xs" disabled={sel?.type !== 'part'} onClick={rotateSel}>⟳ 회전 (R)</button>
          <button type="button" className="btn-ghost px-2 py-0.5 text-xs" disabled={!sel} onClick={removeSel}>🗑 삭제</button>
          <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => { if (confirm('회로를 모두 지울까요?')) { change({ parts: [], wires: [] }); setSel(null) } }}>전체 지우기</button>
          {onLoadModel && <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={onLoadModel}>📐 모범 배선 불러오기</button>}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
          className="h-full w-full touch-none select-none outline-none"
          role="application"
          aria-label="회로 편집기. 부품을 선택한 뒤 방향키로 이동, R 로 회전, Delete 로 삭제. 구멍이나 핀을 차례로 클릭하면 점퍼선이 연결됩니다."
          tabIndex={0}
          onKeyDown={onKey}
          onPointerMove={onSvgPointerMove}
          onPointerLeave={() => { setHover(null); setMouse(null) }}
          onPointerUp={onSvgPointerUp}
        >

          {/* 아두이노 UNO */}
          <g>
            <rect x={UNO.x} y={UNO.y} width={UNO.w} height={UNO.h} rx={10} fill="#0f766e" stroke="#134e4a" strokeWidth={2} />
            <rect x={UNO.x - 8} y={UNO.y + 40} width={44} height={50} rx={3} fill="#9ca3af" />
            <rect x={UNO.x - 4} y={UNO.y + 170} width={36} height={44} rx={3} fill="#1f2937" />
            <rect x={UNO.x + 150} y={UNO.y + 105} width={120} height={36} rx={3} fill="#111827" />
            <text x={UNO.x + 210} y={UNO.y + 128} textAnchor="middle" fontSize={11} fill="#94a3b8">ATmega328P</text>
            <text x={UNO.x + 110} y={UNO.y + 190} fontSize={22} fontWeight={800} fill="#ccfbf1" opacity={0.9}>UNO</text>
            <text x={UNO.x + 50} y={UNO.y + 66} fontSize={9} fill="#99f6e4">DIGITAL (PWM ~)</text>
            <text x={UNO.x + 150} y={UNO.y + UNO.h - 50} fontSize={9} fill="#99f6e4">POWER</text>
            <text x={UNO.x + 268} y={UNO.y + UNO.h - 50} fontSize={9} fill="#99f6e4">ANALOG IN</text>
            {/* 내장 LED (13번) */}
            <rect x={UNO.x + 92} y={UNO.y + 40} width={10} height={6} rx={1} fill={snapshot && snapshot.builtin > 0 ? '#fbbf24' : '#78350f'} />
            {snapshot && snapshot.builtin > 0 && <circle cx={UNO.x + 97} cy={UNO.y + 43} r={9} fill="#fbbf24" opacity={0.5 * snapshot.builtin} filter="url(#glow)" />}
            <text x={UNO.x + 106} y={UNO.y + 46} fontSize={8} fill="#ccfbf1">L</text>
            {ARDUINO_PINS.map((p) => {
              const hl = highlight?.pins.has(p.id) || wireStart === `P:${p.id}`
              return (
                <g key={p.id}>
                  <rect x={p.x - 6} y={p.y - 6} width={12} height={12} rx={1.5} fill={hl ? '#facc15' : '#111827'} stroke="#374151" />
                  <rect x={p.x - 2.5} y={p.y - 2.5} width={5} height={5} fill="#4b5563" />
                  <text x={p.x} y={p.side === 'top' ? p.y + 18 : p.y - 11} textAnchor="middle" fontSize={7} fill="#ecfeff"
                    transform={`rotate(-90 ${p.x} ${p.side === 'top' ? p.y + 18 : p.y - 11})`} dominantBaseline="middle">{p.label}</text>
                </g>
              )
            })}
          </g>

          {/* 브레드보드 */}
          <g>
            <rect x={BB.x} y={BB.y} width={BB.w} height={BB.h} rx={8} className="fill-slate-100 dark:fill-slate-200" stroke="#cbd5e1" />
            <rect x={BB.x + 6} y={holeXY(1, 8).y - 6} width={BB.w - 12} height={52} className="fill-slate-200 dark:fill-slate-300" />
            {RAIL_ROWS.map((y) => (
              <g key={y}>
                <line x1={BB.x + 14} x2={BB.x + BB.w - 14} y1={holeXY(1, y).y + (RAIL_SIGN[y] === '+' ? -10 : 10)} y2={holeXY(1, y).y + (RAIL_SIGN[y] === '+' ? -10 : 10)}
                  stroke={RAIL_SIGN[y] === '+' ? '#ef4444' : '#3b82f6'} strokeWidth={1.5} />
                <text x={BB.x + 10} y={holeXY(1, y).y + 4} fontSize={11} fontWeight={700} fill={RAIL_SIGN[y] === '+' ? '#ef4444' : '#3b82f6'} textAnchor="middle">{RAIL_SIGN[y]}</text>
              </g>
            ))}
            {[...TOP_ROWS, ...BOT_ROWS].map((y) => (
              <text key={y} x={BB.x + 14} y={holeXY(1, y).y + 3} fontSize={8} fill="#94a3b8" textAnchor="middle">{ROW_LETTER[y]}</text>
            ))}
            {Array.from({ length: BB_COLS }, (_, i) => i + 1).filter((c) => c === 1 || c % 5 === 0).map((c) => (
              <text key={c} x={holeXY(c, 2).x} y={holeXY(c, 2).y + 4} fontSize={8} fill="#94a3b8" textAnchor="middle">{c}</text>
            ))}
            {ALL_HOLES.map((h) => {
              const id = holeId(h.col, h.y)
              const { x, y } = holeXY(h.col, h.y)
              const hl = highlight?.holes.has(id)
              return <rect key={id} x={x - 3.5} y={y - 3.5} width={7} height={7} rx={1} fill={hl ? '#facc15' : wireStart === id ? '#f97316' : '#475569'} opacity={hl ? 1 : 0.75} />
            })}
          </g>

          {/* 부품 */}
          {circuit.parts.map((p) => {
            if (drag?.partId === p.id && drag.moved) return null
            const a = anchor(p)
            const selected = sel?.type === 'part' && sel.id === p.id
            return (
              <g key={p.id} transform={`translate(${a.x} ${a.y}) rotate(${p.rot * 90})`}
                onPointerDown={(e) => startPartDrag(e, p)}
                className={readOnly ? '' : p.kind === 'pushbutton' && running ? 'cursor-pointer' : 'cursor-grab'}
                aria-label={PART_DEFS[p.kind].label}>
                {selected && <PartBounds kind={p.kind} />}
                <PartGraphic kind={p.kind} state={partState(p)} legPos={legPosFor(p)} />
              </g>
            )
          })}

          {/* LED·저항 다리 끝 손잡이 — 끌어서 다른 구멍에 구부려 꽂을 수 있다 (LED는 주변 2~3칸, 저항은 리드선처럼 자유롭게) */}
          {!readOnly && circuit.parts.filter((p) => (isLed(p.kind) || isResistor(p.kind)) && !(drag?.partId === p.id && drag.moved)).map((p) => (
            <g key={`legs-${p.id}`}>
              {legHoles(p).map((h) => {
                const xy = holeXY(h.col, h.y)
                return (
                  <circle key={h.leg.id} cx={xy.x} cy={xy.y} r={9} fill="transparent" className="cursor-grab"
                    onPointerDown={(e) => startLegDrag(e, p, h.leg.id)}>
                    <title>{isResistor(p.kind) ? '다리(리드선) 구부리기: 끌어서 원하는 구멍에 자유롭게 꽂으세요' : '다리 구부리기: 끌어서 주변 2~3칸 안의 빈 구멍에 꽂으세요'}</title>
                  </circle>
                )
              })}
            </g>
          ))}

          {/* 점퍼선 */}
          {circuit.wires.map((w) => {
            const a = pointXY(w.a)
            const b = pointXY(w.b)
            const selected = sel?.type === 'wire' && sel.id === w.id
            const d = wirePath(a, b)
            return (
              <g key={w.id} className={readOnly ? '' : 'cursor-pointer'}
                // 부품을 옮기거나 다리를 구부리거나 다른 점퍼선을 잇는 중에는, 이 선의 두꺼운 터치 영역이
                // 아래 구멍으로 가는 포인터 이벤트를 가로채지 않도록 그대로 통과시킨다 (선에 가려진 구멍도 쓸 수 있게)
                onPointerDown={(e) => { if (!drag && !legDrag && !wireStart) e.stopPropagation() }}
                onPointerUp={(e) => {
                  if (readOnly || drag || legDrag || wireStart) return
                  e.stopPropagation()
                  setSel({ type: 'wire', id: w.id })
                  setWireStart(null)
                }}>
                <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
                {selected && <path d={d} fill="none" stroke="#facc15" strokeWidth={9} opacity={0.7} />}
                <path d={d} fill="none" stroke="#0f172a" strokeWidth={5.5} opacity={0.35} />
                <path d={d} fill="none" stroke={wireHex(w.color)} strokeWidth={4} strokeLinecap="round" />
                <circle cx={a.x} cy={a.y} r={3} fill={wireHex(w.color)} stroke="#0f172a" strokeWidth={0.8} />
                <circle cx={b.x} cy={b.y} r={3} fill={wireHex(w.color)} stroke="#0f172a" strokeWidth={0.8} />
              </g>
            )
          })}

          {/* 연결 중인 선 미리보기 */}
          {wireStart && mouse && (
            <path d={wirePath(pointXY(wireStart), mouse)} fill="none" stroke={wireHex(color)} strokeWidth={3} strokeDasharray="6 4" pointerEvents="none" />
          )}

          {/* 다리 구부리기 미리보기 */}
          {legDrag && (() => {
            const draggedPart = circuit.parts.find((x) => x.id === legDrag.partId)
            const hole = nearestHole(legDrag.x, legDrag.y, Math.max(PITCH * 0.7, hitTolerance()))
            const okDist = !!hole && Math.hypot(hole.col - legDrag.defaultCol, hole.y - legDrag.defaultY) <= maxLegBend(draggedPart?.kind ?? 'led-red')
            const valid = !!hole && okDist && canPlaceLeg(circuit, legDrag.partId, legDrag.legId, hole.col, hole.y)
            const target = hole ? holeXY(hole.col, hole.y) : { x: legDrag.x, y: legDrag.y }
            return (
              <g pointerEvents="none">
                <line x1={target.x} y1={target.y} x2={legDrag.x} y2={legDrag.y} stroke={valid ? '#22c55e' : '#ef4444'} strokeWidth={1.5} strokeDasharray="3 2" opacity={0.6} />
                <circle cx={target.x} cy={target.y} r={8} fill="none" stroke={valid ? '#22c55e' : '#ef4444'} strokeWidth={2} />
              </g>
            )
          })()}

          {/* 드래그 고스트 */}
          {drag && drag.moved && (
            <g transform={`translate(${holeXY(drag.col, drag.y).x} ${holeXY(drag.col, drag.y).y}) rotate(${drag.rot * 90})`} opacity={0.75} pointerEvents="none">
              <PartGraphic kind={drag.kind} />
              {PART_DEFS[drag.kind].legs.map((l) => (
                <circle key={l.id} cx={l.dx * 20} cy={l.dy * 20} r={6} fill="none" stroke={ghostValid ? '#22c55e' : '#ef4444'} strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>

        {/* 상태 줄 */}
        <div className="pointer-events-none absolute bottom-1 left-2 right-2 flex flex-wrap gap-2 text-[11px]">
          {hover && (
            <span className="rounded bg-slate-900/80 px-2 py-0.5 text-white">
              {pointName(hover)}{highlight ? ` · 연결된 구멍 ${highlight.holes.size}개${highlight.pins.size ? ` + 핀 ${[...highlight.pins].map((p) => p.replace(/\d$/, '')).join(', ')}` : ''}` : ''}
            </span>
          )}
          {wireStart && <span className="rounded bg-orange-600 px-2 py-0.5 text-white">선 연결 중: {pointName(wireStart)} → 끝점을 클릭 (Esc 취소)</span>}
          {legDrag && (
            <span className="rounded bg-orange-600 px-2 py-0.5 text-white">
              {isResistor(circuit.parts.find((x) => x.id === legDrag.partId)?.kind ?? 'led-red')
                ? '다리(리드선) 구부리는 중: 원하는 빈 구멍 위에서 손을 떼세요'
                : '다리 구부리는 중: 주변 2~3칸 안의 빈 구멍 위에서 손을 떼세요'}
            </span>
          )}
          {msg && <span className="rounded bg-rose-600 px-2 py-0.5 text-white" role="status">{msg}</span>}
        </div>
      </div>
    </div>
  )
})

function PartBounds({ kind }: { kind: CircuitPartKind }) {
  const legs = PART_DEFS[kind].legs
  const xs = legs.map((l) => l.dx * 20)
  const ys = legs.map((l) => l.dy * 20)
  const top = PART_DEFS[kind].module ? -62 : isLed(kind) ? -36 : -10
  return (
    <rect x={Math.min(...xs) - 12} y={Math.min(...ys, top)} width={Math.max(...xs) - Math.min(...xs) + 24} height={Math.max(...ys) + 12 - Math.min(...ys, top)}
      fill="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3" rx={4} />
  )
}

export default CircuitEditor
