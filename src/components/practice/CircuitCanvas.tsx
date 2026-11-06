// 2단계에서 브레드보드 + UNO SVG, 부품 배치, 점퍼선, 넷리스트로 교체된다.
export default function CircuitCanvas() {
  return (
    <svg viewBox="0 0 800 480" className="h-full w-full" role="img" aria-label="회로 캔버스 (준비 중)">
      <rect x="20" y="40" width="250" height="180" rx="10" className="fill-teal-700" />
      <text x="145" y="135" textAnchor="middle" className="fill-white text-[18px] font-bold">Arduino UNO</text>
      <rect x="320" y="40" width="460" height="300" rx="8" className="fill-slate-100 stroke-slate-300 dark:fill-slate-200" />
      <rect x="320" y="186" width="460" height="8" className="fill-slate-300" />
      <text x="550" y="400" textAnchor="middle" className="fill-slate-400 text-[14px]">브레드보드 시뮬레이터는 2단계에서 구현됩니다</text>
    </svg>
  )
}
