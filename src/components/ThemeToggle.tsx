import { useTheme } from '../lib/theme'

export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button type="button" onClick={toggle} className="btn-ghost px-2 py-1.5" aria-label={theme === 'dark' ? '라이트 테마로 바꾸기' : '다크 테마로 바꾸기'}>
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}
