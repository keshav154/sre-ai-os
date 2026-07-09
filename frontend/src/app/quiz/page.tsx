'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { Brain, CheckCircle2, XCircle, PartyPopper, RefreshCw } from 'lucide-react'
import { TerminalWindow, TerminalButton, Blinker } from '@/components/terminal'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface QuizQuestion {
  id: number
  article_id: number
  article_title: string
  question: string
  answer: string
  interval_days: number
  review_count: number
}

export default function Quiz() {
  const [queue, setQueue] = useState<QuizQuestion[]>([])
  const [stats, setStats] = useState({ total: 0, due: 0 })
  const [loading, setLoading] = useState(true)
  const [revealed, setRevealed] = useState(false)
  const [answering, setAnswering] = useState(false)

  const fetchAll = async () => {
    setLoading(true)
    try {
      const [dueRes, statsRes] = await Promise.all([
        apiFetch(`${API}/quiz/due`).then(r => r.json()),
        apiFetch(`${API}/quiz/stats`).then(r => r.json()),
      ])
      setQueue(dueRes)
      setStats(statsRes)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  const current = queue[0]

  const handleAnswer = async (correct: boolean) => {
    if (!current) return
    setAnswering(true)
    try {
      await apiFetch(`${API}/quiz/${current.id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correct })
      })
      setQueue(q => q.slice(1))
      setStats(s => ({ ...s, due: Math.max(0, s.due - 1) }))
      setRevealed(false)
    } catch (e) { console.error(e) }
    setAnswering(false)
  }

  return (
    <div className="min-h-screen bg-term-bg text-term-primary p-6 font-term max-w-3xl mx-auto">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2 uppercase term-glow">
            <Brain className="w-6 h-6" /> RECALL_QUIZ<Blinker className="ml-0.5" />
          </h1>
          <p className="text-term-muted mt-1 text-xs">
            spaced-repetition questions generated from the notes on things you've liked.
          </p>
        </div>
        <TerminalButton onClick={fetchAll}>
          <span className="flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> refresh
          </span>
        </TerminalButton>
      </header>

      <div className="flex gap-4 mb-8">
        <div className="border border-term-amber/50 px-5 py-3 flex flex-col items-center">
          <span className="text-2xl font-extrabold text-term-amber">{stats.due}</span>
          <span className="text-[10px] text-term-muted mt-0.5 uppercase tracking-wide">Due Now</span>
        </div>
        <div className="border border-term-border px-5 py-3 flex flex-col items-center">
          <span className="text-2xl font-extrabold text-term-primary">{stats.total}</span>
          <span className="text-[10px] text-term-muted mt-0.5 uppercase tracking-wide">Total Questions</span>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-term-muted">
          <RefreshCw className="w-10 h-10 mx-auto mb-3 animate-spin opacity-40" />
          <p>loading due questions…</p>
        </div>
      ) : !current ? (
        <TerminalWindow className="text-center py-20">
          <PartyPopper className="w-12 h-12 mx-auto mb-4 text-term-amber" />
          <p className="text-lg font-bold text-term-primary">you're all caught up!</p>
          <p className="text-sm mt-1 text-term-muted">
            {stats.total === 0
              ? 'like a post or video on the dashboard to generate your first recall questions.'
              : 'no questions are due for review right now — check back later.'}
          </p>
        </TerminalWindow>
      ) : (
        <TerminalWindow>
          <p className="text-[10px] font-bold text-term-amber uppercase tracking-wide mb-2">{current.article_title}</p>
          <h2 className="text-lg font-semibold mb-6 leading-relaxed text-term-primary">{current.question}</h2>

          {!revealed ? (
            <TerminalButton solid onClick={() => setRevealed(true)} className="w-full text-center">
              reveal answer
            </TerminalButton>
          ) : (
            <>
              <div className="bg-black border border-term-border p-4 mb-6 text-term-primary/90 text-sm leading-relaxed">
                {current.answer}
              </div>
              <p className="text-xs text-term-muted mb-3">did you get it right?</p>
              <div className="flex gap-3">
                <TerminalButton
                  variant="error"
                  onClick={() => handleAnswer(false)}
                  disabled={answering}
                  className="flex-1 text-center"
                >
                  <span className="flex items-center justify-center gap-2">
                    <XCircle className="w-4 h-4" /> missed it
                  </span>
                </TerminalButton>
                <TerminalButton
                  solid
                  onClick={() => handleAnswer(true)}
                  disabled={answering}
                  className="flex-1 text-center"
                >
                  <span className="flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> got it
                  </span>
                </TerminalButton>
              </div>
            </>
          )}

          <p className="text-xs text-term-muted mt-6 text-center">
            {queue.length - 1} more due after this
          </p>
        </TerminalWindow>
      )}
    </div>
  )
}
