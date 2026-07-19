'use client'
import { useState, useEffect, useRef } from 'react'
import { X, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface ReaderItem {
  url: string
  title: string
  source?: string
}

interface Highlight {
  id: number
  text: string
  note: string | null
  created_at: string
}

export function ReaderModal({ item, onClose }: { item: ReaderItem | null; onClose: () => void }) {
  const [loading, setLoading] = useState(false)
  const [content, setContent] = useState('')
  const [isYoutube, setIsYoutube] = useState(false)
  const [youtubeId, setYoutubeId] = useState('')
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [popup, setPopup] = useState<{ text: string; x: number; y: number } | null>(null)
  const [popupNote, setPopupNote] = useState('')
  const [savingHighlight, setSavingHighlight] = useState(false)
  const [showHighlights, setShowHighlights] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!item) return
    setContent('')
    setIsYoutube(false)
    setYoutubeId('')
    setPopup(null)
    setLoading(true)
    Promise.all([
      apiFetch(`${API}/reader?url=${encodeURIComponent(item.url)}`).then(r => r.json()),
      apiFetch(`${API}/highlights?article_url=${encodeURIComponent(item.url)}`).then(r => r.json()).catch(() => []),
    ]).then(([reader, hl]) => {
      setIsYoutube(reader.is_youtube)
      setYoutubeId(reader.youtube_id || '')
      setContent(reader.content || '')
      setHighlights(hl)
    }).catch(() => setContent('Failed to load content.')).finally(() => setLoading(false))
  }, [item?.url])

  function handleMouseUp() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    setPopupNote('')
    setPopup({
      text: sel.toString().trim(),
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    })
  }

  async function saveHighlight() {
    if (!popup || !item) return
    setSavingHighlight(true)
    try {
      const res = await apiFetch(`${API}/highlights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article_url: item.url,
          article_title: item.title,
          text: popup.text,
          note: popupNote || null,
        }),
      })
      const hl: Highlight = await res.json()
      setHighlights(prev => [hl, ...prev])
      setShowHighlights(true)
    } finally {
      setSavingHighlight(false)
      setPopup(null)
      window.getSelection()?.removeAllRanges()
    }
  }

  async function deleteHighlight(id: number) {
    await apiFetch(`${API}/highlights/${id}`, { method: 'DELETE' })
    setHighlights(prev => prev.filter(h => h.id !== id))
  }

  if (!item) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative flex flex-col w-full max-w-4xl h-[90vh] bg-black border border-green-500/40 rounded-lg shadow-2xl shadow-green-500/10 overflow-hidden">

        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-green-500/30 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-green-400 font-mono text-xs">&#9654;&nbsp;READER</span>
            <span className="text-green-500/40 font-mono text-xs">|</span>
            <span className="text-green-300 font-mono text-sm truncate">{item.title}</span>
          </div>
          <button onClick={onClose} className="text-green-500/60 hover:text-green-400 transition-colors flex-shrink-0 ml-2">
            <X size={18} />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-4 font-mono text-sm text-green-300/90">
          {loading && (
            <div className="flex items-center gap-2 text-green-500/60 mt-8 justify-center">
              <span className="animate-pulse">&#9632;</span>
              <span>Loading content…</span>
            </div>
          )}

          {!loading && isYoutube && youtubeId && (
            <div className="space-y-4">
              <div className="aspect-video w-full rounded border border-green-500/30 overflow-hidden">
                <iframe
                  src={`https://www.youtube.com/embed/${youtubeId}`}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              {content && (
                <div>
                  <button
                    onClick={() => setShowHighlights(v => !v)}
                    className="flex items-center gap-1 text-green-400/70 hover:text-green-400 text-xs mb-2"
                  >
                    {showHighlights ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    Transcript / Description
                  </button>
                  {showHighlights && (
                    <div className="whitespace-pre-wrap text-green-300/70 text-xs border border-green-500/20 rounded p-3">
                      {content}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!loading && !isYoutube && (
            <div
              ref={contentRef}
              onMouseUp={handleMouseUp}
              className="prose prose-invert prose-green max-w-none prose-p:text-green-300/90 prose-headings:text-green-400 prose-a:text-green-400 prose-code:text-green-300 prose-code:bg-green-950/40 prose-pre:bg-green-950/40 prose-blockquote:border-green-500/40 prose-blockquote:text-green-400/70 select-text"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* highlights panel */}
        <div className="flex-shrink-0 border-t border-green-500/20 bg-black/40">
          <button
            onClick={() => setShowHighlights(v => !v)}
            className="flex items-center gap-2 w-full px-4 py-2 text-green-500/70 hover:text-green-400 text-xs font-mono transition-colors"
          >
            {showHighlights ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>HIGHLIGHTS ({highlights.length})</span>
          </button>
          {showHighlights && (
            <div className="px-4 pb-3 space-y-2 max-h-48 overflow-y-auto">
              {highlights.length === 0 && (
                <p className="text-green-500/40 text-xs">Select text above to save a highlight.</p>
              )}
              {highlights.map(h => (
                <div key={h.id} className="flex gap-2 border border-green-500/20 rounded p-2 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-green-300/90 text-xs italic truncate">&#8220;{h.text}&#8221;</p>
                    {h.note && <p className="text-green-500/60 text-xs mt-1">{h.note}</p>}
                  </div>
                  <button
                    onClick={() => deleteHighlight(h.id)}
                    className="text-green-500/30 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* selection popup */}
      {popup && (
        <div
          className="fixed z-[60] flex flex-col gap-2 p-3 bg-black border border-green-400/60 rounded shadow-lg shadow-green-500/20 w-72"
          style={{ left: Math.min(popup.x - 144, window.innerWidth - 300), top: popup.y - 140 }}
          onMouseDown={e => e.stopPropagation()}
        >
          <p className="text-green-400 text-xs font-mono truncate">&#8220;{popup.text.slice(0, 80)}{popup.text.length > 80 ? '…' : ''}&#8221;</p>
          <textarea
            autoFocus
            value={popupNote}
            onChange={e => setPopupNote(e.target.value)}
            placeholder="Add a note (optional)…"
            rows={2}
            className="w-full bg-green-950/30 border border-green-500/30 rounded px-2 py-1 text-green-300 text-xs placeholder-green-600/50 resize-none focus:outline-none focus:border-green-400/60"
          />
          <div className="flex gap-2">
            <button
              onClick={saveHighlight}
              disabled={savingHighlight}
              className="flex-1 bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 text-green-300 text-xs font-mono py-1 rounded transition-colors disabled:opacity-50"
            >
              {savingHighlight ? 'Saving…' : 'Save Highlight'}
            </button>
            <button
              onClick={() => { setPopup(null); window.getSelection()?.removeAllRanges() }}
              className="px-3 text-green-500/60 hover:text-green-400 text-xs font-mono"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}