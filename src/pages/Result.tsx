import { Link } from 'react-router-dom'

// 6단계에서 채점 리포트, 모범답안 비교(나란히), 다시 도전 기능을 채운다.
export default function Result() {
  return (
    <div className="card mx-auto max-w-2xl p-8 text-center">
      <h1 className="text-xl font-bold">채점 결과</h1>
      <p className="mt-2 text-slate-500">채점 리포트는 다음 단계에서 구현됩니다.</p>
      <Link to="/" className="btn-ghost mt-4">홈으로</Link>
    </div>
  )
}
