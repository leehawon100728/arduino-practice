// 부품 그림(PartGraphic, PartIcon)이 공통으로 쓰는 SVG defs. 앱에 한 번만 마운트한다.
export default function PartDefs() {
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
        <linearGradient id="resistorBodyGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#b8905a" />
          <stop offset="18%" stopColor="#f2dcab" />
          <stop offset="45%" stopColor="#e4c589" />
          <stop offset="75%" stopColor="#caa362" />
          <stop offset="100%" stopColor="#a67c42" />
        </linearGradient>
        <linearGradient id="leadGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8e99a8" />
          <stop offset="45%" stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#8e99a8" />
        </linearGradient>
      </defs>
    </svg>
  )
}
