'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { LogOut, RefreshCw } from 'lucide-react'
import { getToken, logout } from '@/lib/api'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const PUBLIC_ROUTES = ['/login', '/signup']

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', emoji: '🏠' },
  { href: '/knowledge', label: 'Knowledge Graph', emoji: '🕸️' },
  { href: '/quiz', label: 'Recall Quiz', emoji: '🧠' },
  { href: '/learning', label: 'Learning Path', emoji: '🎓' },
  { href: '/settings', label: 'Settings', emoji: '⚙️' },
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
      <div className="min-h-screen w-full flex items-center justify-center bg-[#09090b] text-zinc-500">
        <RefreshCw className="w-6 h-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen w-full">
      <aside className="w-56 bg-zinc-950 border-r border-zinc-800 p-5 flex flex-col gap-1 sticky top-0 h-screen overflow-y-auto flex-shrink-0">
        <div className="font-extrabold text-lg mb-6 text-emerald-400 tracking-tight flex items-center gap-2">
          <span className="text-2xl">⚡</span> SRE AI OS
        </div>
        {NAV_ITEMS.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-zinc-800 hover:text-emerald-400 transition-all text-zinc-400 text-sm font-medium"
          >
            <span className="text-base">{item.emoji}</span> {item.label}
          </Link>
        ))}
        <div className="mt-auto pt-4 border-t border-zinc-800">
          <p className="px-3 text-[11px] text-zinc-600 truncate mb-1">{email}</p>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-zinc-800 hover:text-red-400 transition-all text-zinc-400 text-sm font-medium cursor-pointer"
          >
            <LogOut className="w-4 h-4" /> Log Out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
