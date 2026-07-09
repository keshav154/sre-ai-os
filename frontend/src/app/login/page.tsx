'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { LogIn } from 'lucide-react'
import { setToken } from '@/lib/api'
import { Logo, TerminalWindow, TerminalButton, TerminalPromptInput } from '@/components/terminal'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || 'Login failed')
      } else {
        setToken(data.token)
        router.push('/')
      }
    } catch (e) {
      setError('Failed to reach the backend.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-term-bg text-term-primary flex items-center justify-center p-6 font-term term-scanlines">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Logo size="lg" />
          <p className="text-term-muted text-xs mt-4 text-center">$ auth --login</p>
        </div>
        <TerminalWindow>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold mb-1.5 text-term-muted uppercase tracking-wide">email</label>
              <TerminalPromptInput value={email} onChange={setEmail} type="email" prompt=">" required />
            </div>
            <div>
              <label className="block text-[10px] font-bold mb-1.5 text-term-muted uppercase tracking-wide">password</label>
              <TerminalPromptInput value={password} onChange={setPassword} type="password" prompt=">" required />
            </div>
            {error && <p className="text-xs text-term-error">[ ERR ] {error}</p>}
            <TerminalButton solid type="submit" disabled={loading} className="w-full text-center">
              <span className="flex items-center justify-center gap-2">
                <LogIn className="w-4 h-4" /> {loading ? 'signing in...' : 'sign in'}
              </span>
            </TerminalButton>
          </form>
        </TerminalWindow>
        <p className="text-center text-xs text-term-muted mt-4">
          no account? <Link href="/signup" className="text-term-amber hover:underline">sign up</Link>
        </p>
      </div>
    </div>
  )
}
