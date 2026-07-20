'use client'
import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, BookOpen, Brain, Zap, Highlighter, ExternalLink } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { TerminalButton, StatusTag } from '@/components/terminal'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Briefing {
  new_articles_count: number
  quiz_due_count: number
  total_highlights: number
  resurfaced_highlight: { text: string; note: string | null; article_title: string | null; created_at: string } | null
  top_article: { id: number; title: string; url: string; source: string; summary: string } | null
  date: string
}

export function DailyBriefing({
  onReadArticle,
  onGoToQuiz,
  onGoToFeed,
}: {
  onReadArticle: (item: { url: string; title: string; source?: string }) => void
  onGoToQuiz: () => void
  onGoToFeed: () => void
}) {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    apiFetch(`${API}/daily-briefing`)
      .then(r => r.json())
      .then(setBriefing)
      .catch(() => {})
  }, [])

  if (!briefing) return null

  const hasContent =
    briefing.new_articles_count > 0 ||
    briefing.quiz_due_count > 0 ||
    briefing.resurfaced_highlight ||
    briefing.top_article

  if (!hasContent) return null

  return (
    <div className="mb-6 border border-green-500/40 bg-green-950/10 rounded-sm font-mono">
      {/* header row */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-green-500/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-green-400 text-xs font-bold tracking-widest uppercase">
            &#9673; Daily Briefing
          </span>
          <span className="text-green-500/50 text-xs">{briefing.date}</span>
        </div>
        <div className="flex items-center gap-3">
          {briefing.new_articles_count > 0 && (
            <span className="text-green-400 text-xs">{briefing.new_articles_count} new</span>
          )}
          {briefing.quiz_due_count > 0 && (
            <span className="text-amber-400 text-xs">{briefing.quiz_due_count} due</span>
          )}
          {open ? <ChevronDown size={14} className="text-green-500/60" /> : <ChevronRight size={14} className="text-green-500/60" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-green-500/20">
          {/* stat chips */}
          <div className="flex flex-wrap gap-3 pt-3">
            <button
              onClick={onGoToFeed}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-green-500/30 hover:border-green-400 text-green-300/80 hover:text-green-300 text-xs transition-colors"
            >
              <BookOpen size={12} />
              {briefing.new_articles_count} new article{briefing.new_articles_count !== 1 ? 's' : ''} in feed
            </button>
            {briefing.quiz_due_count > 0 && (
              <button
                onClick={onGoToQuiz}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-amber-500/40 hover:border-amber-400 text-amber-400/80 hover:text-amber-400 text-xs transition-colors"
              >
                <Brain size={12} />
                {briefing.quiz_due_count} flashcard{briefing.quiz_due_count !== 1 ? 's' : ''} due for review
              </button>
            )}
            {briefing.total_highlights > 0 && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 border border-green-500/20 text-green-500/50 text-xs">
                <Highlighter size={12} />
                {briefing.total_highlights} highlight{briefing.total_highlights !== 1 ? 's' : ''} saved
              </span>
            )}
          </div>

          {/* resurfaced highlight */}
          {briefing.resurfaced_highlight && (
            <div className="border border-green-500/20 bg-black/30 px-3 py-2.5 space-y-1">
              <p className="text-green-500/50 text-[10px] uppercase tracking-wider flex items-center gap-1.5">
                <Zap size={10} /> Resurfaced from your highlights
              </p>
              <p className="text-green-300/90 text-sm italic">
                &#8220;{briefing.resurfaced_highlight.text}&#8221;
              </p>
              {briefing.resurfaced_highlight.note && (
                <p className="text-green-500/60 text-xs">{briefing.resurfaced_highlight.note}</p>
              )}
              {briefing.resurfaced_highlight.article_title && (
                <p className="text-green-500/40 text-[10px]">from: {briefing.resurfaced_highlight.article_title}</p>
              )}
            </div>
          )}

          {/* top article */}
          {briefing.top_article && (
            <div className="border border-green-500/20 px-3 py-2.5 space-y-2">
              <p className="text-green-500/50 text-[10px] uppercase tracking-wider">Top pick for today</p>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-green-300 text-sm font-bold line-clamp-1">{briefing.top_article.title}</p>
                  {briefing.top_article.summary && (
                    <p className="text-green-400/60 text-xs mt-1 line-clamp-2">{briefing.top_article.summary}</p>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <TerminalButton
                    size="sm"
                    variant={briefing.top_article.source === 'YouTube' ? 'error' : 'primary'}
                    onClick={() => onReadArticle({ url: briefing.top_article!.url, title: briefing.top_article!.title, source: briefing.top_article!.source })}
                  >
                    {briefing.top_article.source === 'YouTube' ? 'watch' : 'read'}
                  </TerminalButton>
                  <a
                    href={briefing.top_article.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center text-green-500/40 hover:text-green-400 transition-colors"
                  >
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
