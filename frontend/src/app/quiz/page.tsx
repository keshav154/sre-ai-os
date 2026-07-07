'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { Brain, CheckCircle2, XCircle, PartyPopper, RefreshCw } from 'lucide-react'

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
    <div className="min-h-screen bg-[#09090b] text-zinc-100 p-6 font-sans max-w-3xl mx-auto">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold flex items-center gap-3">
            <Brain className="text-violet-400 w-8 h-8" /> Recall Quiz
          </h1>
          <p className="text-zinc-400 mt-1 text-sm">
            Spaced-repetition questions generated from the notes on things you've liked.
          </p>
        </div>
        <button
          onClick={fetchAll}
          className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 px-4 py-2 rounded-lg font-bold transition-colors cursor-pointer text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      <div className="flex gap-4 mb-8">
        <div className="bg-zinc-900 border border-violet-900/40 rounded-xl px-5 py-3 flex flex-col items-center">
          <span className="text-2xl font-extrabold text-violet-400">{stats.due}</span>
          <span className="text-xs text-zinc-500 mt-0.5">Due Now</span>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-3 flex flex-col items-center">
          <span className="text-2xl font-extrabold text-zinc-300">{stats.total}</span>
          <span className="text-xs text-zinc-500 mt-0.5">Total Questions</span>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-zinc-600">
          <RefreshCw className="w-10 h-10 mx-auto mb-3 animate-spin opacity-40" />
          <p>Loading due questions…</p>
        </div>
      ) : !current ? (
        <div className="text-center py-20 text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-xl">
          <PartyPopper className="w-12 h-12 mx-auto mb-4 text-violet-400" />
          <p className="text-lg font-bold text-zinc-300">You're all caught up!</p>
          <p className="text-sm mt-1">
            {stats.total === 0
              ? 'Like a post or video on the dashboard to generate your first recall questions.'
              : 'No questions are due for review right now — check back later.'}
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8">
          <p className="text-xs font-bold text-violet-400 uppercase tracking-wide mb-2">{current.article_title}</p>
          <h2 className="text-xl font-semibold mb-6 leading-relaxed">{current.question}</h2>

          {!revealed ? (
            <button
              onClick={() => setRevealed(true)}
              className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-bold transition-colors cursor-pointer"
            >
              Reveal Answer
            </button>
          ) : (
            <>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 mb-6 text-zinc-300 text-sm leading-relaxed">
                {current.answer}
              </div>
              <p className="text-xs text-zinc-500 mb-3">Did you get it right?</p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleAnswer(false)}
                  disabled={answering}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-900/30 hover:bg-red-900/50 disabled:opacity-50 text-red-300 rounded-lg font-bold transition-colors cursor-pointer"
                >
                  <XCircle className="w-5 h-5" /> Missed It
                </button>
                <button
                  onClick={() => handleAnswer(true)}
                  disabled={answering}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-900/30 hover:bg-emerald-900/50 disabled:opacity-50 text-emerald-300 rounded-lg font-bold transition-colors cursor-pointer"
                >
                  <CheckCircle2 className="w-5 h-5" /> Got It
                </button>
              </div>
            </>
          )}

          <p className="text-xs text-zinc-600 mt-6 text-center">
            {queue.length - 1} more due after this
          </p>
        </div>
      )}
    </div>
  )
}
