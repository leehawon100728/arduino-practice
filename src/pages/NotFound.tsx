import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="card mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-bold">페이지를 찾을 수 없어요</h1>
      <Link to="/" className="btn-primary mt-4">홈으로</Link>
    </div>
  )
}
