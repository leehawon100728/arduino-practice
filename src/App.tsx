import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import PartDefs from './components/circuit/PartDefs'
import Home from './pages/Home'
import Basics from './pages/Basics'
import SensorList from './pages/SensorList'
import ComboSelect from './pages/ComboSelect'
import ExamSetup from './pages/ExamSetup'
import Review from './pages/Review'
import NotFound from './pages/NotFound'

// 에디터·시뮬레이터가 들어간 화면은 필요할 때 불러온다
const Practice = lazy(() => import('./pages/Practice'))
const Result = lazy(() => import('./pages/Result'))

const Loading = () => <div className="grid h-full place-items-center p-10 text-slate-500" role="status">불러오는 중…</div>

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <PartDefs />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="basics" element={<Basics />} />
          <Route path="sensors" element={<SensorList />} />
          <Route path="combo" element={<ComboSelect />} />
          <Route path="exam" element={<ExamSetup />} />
          <Route path="review" element={<Review />} />
          <Route path="result" element={<Result />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="practice" element={<Practice />} />
      </Routes>
    </Suspense>
  )
}
