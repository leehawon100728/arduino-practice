import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Basics from './pages/Basics'
import SensorList from './pages/SensorList'
import ComboSelect from './pages/ComboSelect'
import ExamSetup from './pages/ExamSetup'
import Review from './pages/Review'
import Practice from './pages/Practice'
import Result from './pages/Result'
import NotFound from './pages/NotFound'

export default function App() {
  return (
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
      {/* 실습 화면은 전체 화면 레이아웃 */}
      <Route path="practice" element={<Practice />} />
    </Routes>
  )
}
