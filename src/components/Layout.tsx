import { Link, NavLink, Outlet } from 'react-router-dom'
import ThemeToggle from './ThemeToggle'

const NAV = [
  { to: '/basics', label: '기본기' },
  { to: '/sensors', label: '센서별' },
  { to: '/combo', label: '조합' },
  { to: '/exam', label: '실전' },
  { to: '/review', label: '약점 복습' },
]

export default function Layout() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-bold">
            <span aria-hidden className="grid size-7 place-items-center rounded-md bg-brand-600 text-sm text-white">⚡</span>
            <span className="hidden sm:inline">아두이노 수행평가 연습</span>
          </Link>
          <nav aria-label="주요 메뉴" className="ml-auto flex items-center gap-1 overflow-x-auto text-sm">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-md px-2.5 py-1.5 ${isActive ? 'bg-brand-100 text-brand-900 dark:bg-brand-900 dark:text-brand-100' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
