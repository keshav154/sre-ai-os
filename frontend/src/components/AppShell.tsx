'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { LogOut, RefreshCw, LayoutDashboard, Network, Brain, GraduationCap, Settings as SettingsIcon } from 'lucide-react'
import { getToken, logout } from '@/lib/api'
import { Logo } from '@/components/terminal'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const PUBLIC_ROUTES = ['/login', '/signup']

const NAV_ITEMS = [
  { href: '/', label: 'dashboard', icon: LayoutDashboard },
  { href: '/knowledge', label: 'knowledge graph', icon: Network },
  { href: '/quiz', label: 'recall quiz', icon: Brain },
  { href: '/learning', label: 'learning path', icon: GraduationCap },
  { href: '/settings', label: 'settings', icon: SettingsIcon },
]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [email, setEmail] = useState('')

  const isPublicRoute = PUBLIC_ROUTES.includes(pathname)

  useEffect(() => {
    if (isPublicRoute) {
      setChecking(false)
      return
    }
    const token = getToken()
    if (!token) {
      router.replace('/login')
      return
    }
    // Validate the token actually still works (not expired/revoked) rather
    // than just trusting that it's present in localStorage.
    fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        if (!res.ok) throw new Error('invalid session')
        return res.json()
      })
      .then(data => {
        setEmail(data.email)
        setChecking(false)
      })
      .catch(() => {
        router.replace('/login')
      })
  }, [pathname, isPublicRoute, router])

  if (isPublicRoute) {
    return <>{children}</>
  }

  if (checking) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-term-bg text-term-muted font-term">
        <RefreshCw className="w-6 h-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen w-full bg-term-bg font-term term-scanlines">
      <aside className="w-56 bg-term-bg border-r border-term-border p-4 flex flex-col gap-1 sticky top-0 h-screen overflow-y-auto flex-shrink-0">
        <div className="mb-6 px-1">
          <Logo size="sm" />
        </div>
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 border text-xs font-bold uppercase tracking-wide transition-colors
                ${active
                  ? 'bg-term-primary text-term-bg border-term-primary'
                  : 'border-transparent text-term-muted hover:text-term-primary hover:border-term-border'}`}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" /> {item.label}
            </Link>
          )
        })}
        <div className="mt-auto pt-4 border-t border-dashed border-term-border">
          <p className="px-3 text-[10px] text-term-muted truncate mb-1 font-term">$ whoami<br />{email}</p>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2.5 px-3 py-2 border border-transparent hover:border-term-error hover:text-term-error transition-colors text-term-muted text-xs font-bold uppercase tracking-wide cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" /> log out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
