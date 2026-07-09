'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { UserPlus } from 'lucide-react'
import { setToken } from '@/lib/api'
import { Logo, TerminalWindow, TerminalButton, TerminalPromptInput } from '@/components/terminal'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function Signup() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, invite_code: inviteCode })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || 'Signup failed')
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
          <p className="text-term-muted text-xs mt-4 text-center">
            $ auth --signup<br />
            <span className="text-[10px]">note: everyone who signs up shares the same vault, goals &amp; settings — this app protects who gets in, not per-person data.</span>
          </p>
        </div>
        <TerminalWindow>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold mb-1.5 text-term-muted uppercase tracking-wide">email</label>
              <TerminalPromptInput value={email} onChange={setEmail} type="email" prompt=">" required />
            </div>
            <div>
              <label className="block text-[10px] font-bold mb-1.5 text-term-muted uppercase tracking-wide">password</label>
              <TerminalPromptInput value={password} onChange={setPassword} type="password" prompt=">" required minLength={8} />
              <p className="text-[10px] text-term-muted mt-1">min 8 characters.</p>
            </div>
            <div>
              <label className="block text-[10px] font-bold mb-1.5 text-term-muted uppercase tracking-wide">confirm password</label>
              <TerminalPromptInput value={confirmPassword} onChange={setConfirmPassword} type="password" prompt=">" required />
            </div>
            <div>
              <label className="block text-[10px] font-bold mb-1.5 text-term-muted uppercase tracking-wide">invite code</label>
              <TerminalPromptInput value={inviteCode} onChange={setInviteCode} type="password" prompt=">" required />
              <p className="text-[10px] text-term-muted mt-1">ask whoever runs this instance for the invite code.</p>
            </div>
            {error && <p className="text-xs text-term-error">[ ERR ] {error}</p>}
            <TerminalButton solid variant="amber" type="submit" disabled={loading} className="w-full text-center">
              <span className="flex items-center justify-center gap-2">
                <UserPlus className="w-4 h-4" /> {loading ? 'creating account...' : 'sign up'}
              </span>
            </TerminalButton>
          </form>
        </TerminalWindow>
        <p className="text-center text-xs text-term-muted mt-4">
          already have an account? <Link href="/login" className="text-term-amber hover:underline">sign in</Link>
        </p>
      </div>
    </div>
  )
}
