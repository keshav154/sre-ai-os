'use client'
import { useState, useEffect, useMemo } from 'react'
import { apiFetch } from '@/lib/api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BookOpen, Activity, Zap, RefreshCw, Terminal, Bookmark, Eye, EyeOff, X, AlertCircle, Heart, Sparkles, FileText, Lightbulb, Target, Check } from "lucide-react"
import { TerminalWindow, TerminalButton, AsciiDivider, Blinker, StatusTag, TerminalPromptInput } from '@/components/terminal'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function Dashboard() {
  const [savedArticles, setSavedArticles] = useState([])
  const [goals, setGoals] = useState<any[]>([])
  const [cves, setCves] = useState<any[]>([])
  const [refreshingCves, setRefreshingCves] = useState(false)
  const [liveFeed, setLiveFeed] = useState<any[]>([])
  const [viewedUrls, setViewedUrls] = useState<Set<string>>(new Set())
  const [url, setUrl] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [processingAction, setProcessingAction] = useState<{url: string, action: string} | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [sourceFilter, setSourceFilter] = useState('All')
  const [sortBy, setSortBy] = useState('Newest')
  const [activeTab, setActiveTab] = useState<'feed' | 'viewed'>('feed')
  const [toast, setToast] = useState<{msg: string, type: 'error' | 'success'} | null>(null)
  const [savedSearch, setSavedSearch] = useState('')
  const [savedSearchResults, setSavedSearchResults] = useState<any[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [expandedRelated, setExpandedRelated] = useState<Set<string>>(new Set())
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())
  const [expandedConcept, setExpandedConcept] = useState<Set<string>>(new Set())
  const [conceptNotes, setConceptNotes] = useState<Record<number, { content: string; source_titles: string[] }>>({})
  const [consolidating, setConsolidating] = useState<number | null>(null)
  const [agentMode, setAgentMode] = useState<'research' | 'runbook'>('research')
  const [agentInput, setAgentInput] = useState('')
  const [agentRunning, setAgentRunning] = useState(false)
  const [agentResult, setAgentResult] = useState('')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [reflecting, setReflecting] = useState(false)
  const [actingOn, setActingOn] = useState<number | null>(null)
  const itemsPerPage = 12

  const showToast = (msg: string, type: 'error' | 'success' = 'error') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 5000)
  }

  // ── Load viewed URLs from localStorage on mount ──
  useEffect(() => {
    const stored = localStorage.getItem('viewedUrls')
    if (stored) {
      try { setViewedUrls(new Set(JSON.parse(stored))) } catch {}
    }
  }, [])

  const persistViewed = (newSet: Set<string>) => {
    setViewedUrls(newSet)
    localStorage.setItem('viewedUrls', JSON.stringify([...newSet]))
  }

  const markAsViewed = (itemUrl: string) => {
    const next = new Set(viewedUrls)
    next.add(itemUrl)
    persistViewed(next)
  }

  const unmarkViewed = (itemUrl: string) => {
    const next = new Set(viewedUrls)
    next.delete(itemUrl)
    persistViewed(next)
  }

  const clearAllViewed = () => {
    persistViewed(new Set())
  }

  const savedArticlesMap = useMemo(() => {
    const map = new Map()
    savedArticles.forEach((sa: any) => map.set(sa.url, sa))
    return map
  }, [savedArticles])

  // Separate feed from viewed
  const { unviewedFeed, viewedFeed } = useMemo(() => {
    const unviewed: any[] = []
    const viewed: any[] = []
    liveFeed.forEach(item => {
      // Near-duplicate coverage of the same story is collapsed server-side
      // onto the newest item's `related` list — skip the collapsed copies
      // here so they don't also take up a card of their own.
      if ((item as any).hidden_duplicate) return
      if (viewedUrls.has((item as any).url)) {
        viewed.push(item)
      } else {
        unviewed.push(item)
      }
    })
    return { unviewedFeed: unviewed, viewedFeed: viewed }
  }, [liveFeed, viewedUrls])

  const availableSources = useMemo(() => {
    const sources = new Set(unviewedFeed.map((item: any) => item.source))
    return ['All', ...Array.from(sources)]
  }, [unviewedFeed])

  // Words pulled from active Learning Goal titles/descriptions, used as a
  // free (no LLM call) relevance signal — how much a feed item's text
  // overlaps with what the user says they're trying to learn right now.
  const goalKeywords = useMemo(() => {
    const stopwords = new Set(['this','that','with','from','have','will','your','about','into','learn','learning','the','and','for','are','you'])
    const words = new Set<string>()
    for (const g of goals) {
      const text = `${g.title || ''} ${g.description || ''}`.toLowerCase()
      for (const w of text.match(/[a-z0-9]+/g) || []) {
        if (w.length > 3 && !stopwords.has(w)) words.add(w)
      }
    }
    return words
  }, [goals])

  const relevanceScore = (item: any) => {
    if (goalKeywords.size === 0) return 0
    const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase()
    let score = 0
    for (const w of goalKeywords) {
      if (text.includes(w)) score++
    }
    return score
  }

  const displayedFeed = useMemo(() => {
    let filtered = [...unviewedFeed]
    if (sourceFilter !== 'All') {
      filtered = filtered.filter((item: any) => item.source === sourceFilter)
    }
    if (sortBy === 'Newest') {
      filtered.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0))
    } else if (sortBy === 'Oldest') {
      filtered.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0))
    } else if (sortBy === 'Relevant') {
      // Higher overlap with active goals first; ties broken by recency.
      filtered.sort((a: any, b: any) => {
        const diff = relevanceScore(b) - relevanceScore(a)
        return diff !== 0 ? diff : (b.timestamp || 0) - (a.timestamp || 0)
      })
    } else if (sortBy === 'Balanced') {
      // Round-robin across keyword/feed groups (each internally newest-first)
      // so one trending keyword can't bury every other topic on page 1.
      const groups = new Map<string, any[]>()
      for (const item of filtered) {
        const key = item.keyword || item.source || 'other'
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(item)
      }
      for (const group of groups.values()) {
        group.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0))
      }
      const bucketed: any[] = []
      const queues = Array.from(groups.values())
      let remaining = queues.reduce((n, q) => n + q.length, 0)
      let i = 0
      while (remaining > 0) {
        const q = queues[i % queues.length]
        if (q.length) {
          bucketed.push(q.shift())
          remaining--
        }
        i++
      }
      filtered = bucketed
    }
    return filtered.slice(0, currentPage * itemsPerPage)
  }, [unviewedFeed, currentPage, sourceFilter, sortBy, goalKeywords])

  const fetchSavedArticles = async () => {
    try {
      const res = await apiFetch(`${API}/articles?limit=100`)
      const data = await res.json()
      setSavedArticles(data)
    } catch (e) { console.error(e) }
  }

  // Debounced search over saved articles (title/summary/content).
  useEffect(() => {
    if (!savedSearch.trim()) { setSavedSearchResults(null); return }
    setSearching(true)
    const handle = setTimeout(async () => {
      try {
        const res = await apiFetch(`${API}/articles?q=${encodeURIComponent(savedSearch.trim())}&limit=200`)
        const data = await res.json()
        setSavedSearchResults(data)
      } catch (e) { console.error(e) }
      setSearching(false)
    }, 300)
    return () => clearTimeout(handle)
  }, [savedSearch])

  const fetchGoals = async () => {
    try {
      const res = await apiFetch(`${API}/goals`)
      const data = await res.json()
      setGoals(data.filter((g: any) => g.status === 'active'))
    } catch (e) { console.error(e) }
  }

  const fetchCves = async () => {
    try {
      const res = await apiFetch(`${API}/cves`)
      setCves(await res.json())
    } catch (e) { console.error(e) }
  }

  const handleRefreshCves = async () => {
    setRefreshingCves(true)
    try {
      await apiFetch(`${API}/cves/refresh`, { method: 'POST' })
      showToast('Fetching recent CVEs in the background — check back in a moment.', 'success')
      // The refresh runs server-side in the background (NVD is rate-limited),
      // so poll once after a delay rather than blocking on it here.
      setTimeout(fetchCves, 15000)
    } catch (e) {
      showToast('Failed to start CVE refresh')
    }
    setRefreshingCves(false)
  }

  const fetchSuggestions = async () => {
    try {
      const res = await apiFetch(`${API}/suggestions`)
      setSuggestions(await res.json())
    } catch (e) { console.error(e) }
  }

  const handleReflectNow = async () => {
    setReflecting(true)
    try {
      const res = await apiFetch(`${API}/agent/reflect`, { method: 'POST' })
      const data = await res.json()
      if (data.created > 0) {
        showToast(`Found ${data.created} new suggestion(s).`, 'success')
        fetchSuggestions()
      } else {
        showToast('Nothing new to suggest right now — all caught up.', 'success')
      }
    } catch (e) {
      showToast('Failed to run the reflect agent.')
    }
    setReflecting(false)
  }

  const handleSuggestionAction = async (s: any, action: 'accept' | 'dismiss') => {
    setActingOn(s.id)
    try {
      const res = await apiFetch(`${API}/suggestions/${s.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
      if (!res.ok) throw new Error()
      setSuggestions(prev => prev.filter(x => x.id !== s.id))
      if (action === 'accept' && s.type === 'new_goal') {
        showToast(`Created goal "${s.title}" — check Learning Path.`, 'success')
        fetchGoals()
      } else if (action === 'accept' && s.type === 'open_loop') {
        showToast('Added back to your recall quiz queue.', 'success')
      }
    } catch (e) {
      showToast('Failed to update suggestion')
    }
    setActingOn(null)
  }

  const attachToGoal = async (item: any, goalId: string, stepTitle?: string, stepDescription?: string) => {
    if (!goalId) return
    const goal = goals.find(g => g.id === Number(goalId))
    try {
      const res = await apiFetch(`${API}/goals/${goalId}/steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal_id: Number(goalId),
          title: stepTitle || item.title,
          description: stepDescription || `Resource: ${item.url}`,
          order_index: goal?.steps?.length ?? 0,
        })
      })
      if (!res.ok) throw new Error('failed')
      showToast(`Added to "${goal?.title || 'goal'}"`, 'success')
      fetchGoals()
    } catch (e) {
      showToast('Failed to attach to goal')
    }
  }

  // Pulls the bullet lines out of the "## Action Items" section of an
  // AI-generated note (see the /like prompt in main.py), so each one can
  // get its own "+ Goal" button instead of the whole note being one
  // opaque block of text.
  const extractActionItems = (notes: string): string[] => {
    const match = notes.match(/##\s*Action Items\s*\n([\s\S]*?)(\n##\s|\n?$)/i)
    if (!match) return []
    return match[1]
      .split('\n')
      .map(line => line.replace(/^\s*[-*]\s+|^\s*\d+[.)]\s+/, '').trim())
      .filter(Boolean)
  }

  const handleConsolidate = async (item: any) => {
    if (!item.id) return
    setConsolidating(item.id)
    try {
      const res = await apiFetch(`${API}/articles/${item.id}/consolidate`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.detail || 'Failed to consolidate')
      } else {
        setConceptNotes(prev => ({ ...prev, [item.id]: { content: data.content, source_titles: data.source_titles } }))
        setExpandedConcept(prev => new Set(prev).add(item.url))
        showToast(data.saved_to_vault ? `Consolidated "${data.concept}" concept note ✓ saved to vault` : `Consolidated "${data.concept}" concept note (configure a vault to auto-save it)`, 'success')
      }
    } catch (e) {
      showToast('Failed to reach the backend.')
    }
    setConsolidating(null)
  }

  useEffect(() => {
    fetchSavedArticles()
    fetchGoals()
    fetchCves()
    fetchSuggestions()
    const cachedFeed = localStorage.getItem('liveFeed')
    if (cachedFeed) {
      try { setLiveFeed(JSON.parse(cachedFeed)) } catch {}
    } else {
      handleDiscover(false)
    }
  }, [])

  const handleDiscover = async (force = true) => {
    setDiscovering(true)
    localStorage.removeItem('liveFeed')
    try {
      const res = await apiFetch(`${API}/discover${force ? '?force=true' : ''}`)
      const data = await res.json()
      setLiveFeed(data)
      setCurrentPage(1)
      localStorage.setItem('liveFeed', JSON.stringify(data))
    } catch (e) { console.error(e) }
    setDiscovering(false)
  }

  // `feedItem` is passed when the action originates from a discover feed
  // card — its RSS-provided title/summary become a last-resort fallback
  // server-side if the full page fetch gets bot-blocked, so a block
  // doesn't have to be a dead end.
  const fallbackFields = (feedItem?: any) => feedItem ? {
    fallback_title: feedItem.title,
    fallback_content: feedItem.summary,
  } : {}

  const handleSummarize = async (targetUrl: string, feedItem?: any) => {
    setProcessingAction({ url: targetUrl, action: 'summarize' })
    try {
      const res = await apiFetch(`${API}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, ...fallbackFields(feedItem) })
      })
      if (!res.ok) {
        const err = await res.json()
        showToast(err.detail || 'Summarization failed')
      }
      fetchSavedArticles()
    } catch (e) { console.error(e) }
    setProcessingAction(null)
  }

  const handleSaveToVault = async (targetUrl: string, feedItem?: any) => {
    setProcessingAction({ url: targetUrl, action: 'save' })
    try {
      const res = await apiFetch(`${API}/save-to-vault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, ...fallbackFields(feedItem) })
      })
      if (!res.ok) {
        const err = await res.json()
        showToast(err.detail || 'Failed to save to vault')
      } else {
        showToast('Saved to Obsidian vault! ✓', 'success')
        fetchSavedArticles()
      }
    } catch (e) { console.error(e) }
    setProcessingAction(null)
  }

  const handleLike = async (targetUrl: string, feedItem?: any) => {
    setProcessingAction({ url: targetUrl, action: 'like' })
    try {
      const res = await apiFetch(`${API}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, ...fallbackFields(feedItem) })
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.detail || 'Failed to generate notes')
      } else {
        showToast(data.saved_to_vault ? 'Liked! AI notes saved to vault ❤️' : 'Liked! AI notes generated (configure a vault to auto-save them).', 'success')
        fetchSavedArticles()
      }
    } catch (e) { console.error(e) }
    setProcessingAction(null)
  }

  const handleQuickIngest = async () => {
    if (!url) return
    setIngesting(true)
    await handleSummarize(url)
    setUrl('')
    setIngesting(false)
  }

  const handleRunAgent = async () => {
    if (!agentInput.trim()) return
    setAgentRunning(true)
    setAgentResult('')
    try {
      const endpoint = agentMode === 'research' ? '/agent/research' : '/agent/runbook'
      const res = await apiFetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: agentInput.trim() })
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.detail || 'Agent failed')
      } else {
        setAgentResult(data.response)
        showToast(data.saved_to_vault ? 'Saved to your vault ✓' : 'Done (vault not configured, so not saved to a file)', 'success')
        fetchSavedArticles()
      }
    } catch (e) {
      showToast('Failed to reach the backend.')
    }
    setAgentRunning(false)
  }

  // Open article and mark as viewed
  const openItem = (item: any) => {
    window.open(item.url, '_blank')
    markAsViewed(item.url)
  }

  // Research/Runbook agent output is saved as an Article with a synthetic
  // research-agent:// / runbook-agent:// url (no real page to open), so
  // guard against trying to open those as a link.
  const openSavedItem = (item: any) => {
    if (item.url?.startsWith('http')) window.open(item.url, '_blank')
  }

  const SOURCE_VARIANT: Record<string, 'primary' | 'amber' | 'error'> = {
    YouTube: 'error',
    Medium: 'amber',
  }

  const FeedCard = ({ item, showUnviewBtn = false }: { item: any; showUnviewBtn?: boolean }) => {
    const savedItem = savedArticlesMap.get(item.url)
    const isSaved = !!savedItem
    const isLiked = !!savedItem?.liked
    const isSummarizing = processingAction?.url === item.url && processingAction?.action === 'summarize'
    const isSaving = processingAction?.url === item.url && processingAction?.action === 'save'
    const isLiking = processingAction?.url === item.url && processingAction?.action === 'like'
    const isViewed = viewedUrls.has(item.url)
    const showRelated = expandedRelated.has(item.url)
    const toggleRelated = () => {
      setExpandedRelated(prev => {
        const next = new Set(prev)
        next.has(item.url) ? next.delete(item.url) : next.add(item.url)
        return next
      })
    }

    return (
      <TerminalWindow
        variant={isViewed ? undefined : (SOURCE_VARIANT[item.source] || 'primary')}
        noPadding
        className={`flex flex-col h-full group ${isViewed ? 'opacity-50' : ''}`}
        onClick={() => openItem(item)}
      >
        <div className="flex items-center justify-between px-3 py-1.5 text-xs font-bold uppercase tracking-wide bg-term-muted/20 border-b border-term-border">
          <span className={item.source === 'YouTube' ? 'text-term-error' : item.source === 'Medium' ? 'text-term-amber' : 'text-term-primary'}>
            {item.source}
          </span>
          <span className="flex items-center gap-2 text-term-muted normal-case font-normal">
            {isViewed && <><Eye className="w-3 h-3" />viewed</>}
            {item.date_str}
          </span>
        </div>

        {item.thumbnail && (
          <div className="w-full h-32 overflow-hidden bg-black relative flex-shrink-0">
            <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover grayscale opacity-70 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-300" />
          </div>
        )}

        <div className="flex-1 flex flex-col p-3">
          <div className="mb-2">
            <h3 className="font-bold text-sm leading-snug group-hover:text-term-primary transition-colors line-clamp-2">{item.title}</h3>
            {item.related?.length > 0 && (
              <div onClick={e => e.stopPropagation()} className="mt-1.5">
                <button
                  onClick={toggleRelated}
                  className="font-term text-[10px] font-bold text-term-muted hover:text-term-primary cursor-pointer"
                >
                  {showRelated ? '▾' : '▸'} similar coverage: {item.related.length} more source{item.related.length > 1 ? 's' : ''}
                </button>
                {showRelated && (
                  <div className="mt-1.5 space-y-1">
                    {item.related.map((r: any, ri: number) => (
                      <a
                        key={ri}
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block font-term text-[10px] text-term-muted hover:text-term-primary truncate"
                      >
                        {'>'} {r.source}: {r.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="text-xs mb-3 flex-1 term-prose">
            {isLiked && savedItem.notes ? (
              <>
                <p className="text-[10px] font-bold text-term-amber uppercase tracking-wide mb-1">// AI Notes</p>
                <div className="line-clamp-5 overflow-hidden">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{savedItem.notes}</ReactMarkdown>
                </div>
              </>
            ) : isSaved ? (
              <div className="line-clamp-5 overflow-hidden">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{savedItem.summary}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-term-muted italic line-clamp-3">{item.summary}</p>
            )}
          </div>

          <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1.5 items-center pt-2 border-t border-dashed border-term-border" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => handleLike(item.url, item)}
              disabled={isLiking || isLiked}
              title={isLiked ? 'Liked — AI notes generated' : 'Like & generate AI notes'}
              className="cursor-pointer disabled:cursor-default"
            >
              <Heart className={`w-3.5 h-3.5 ${isLiked ? 'fill-term-error text-term-error' : 'text-term-muted hover:text-term-error'} ${isLiking ? 'animate-pulse' : ''}`} />
            </button>
            {!isSaved && (
              <TerminalButton size="sm" onClick={() => handleSummarize(item.url, item)} disabled={isSummarizing || isSaving}>
                {isSummarizing ? 'thinking...' : 'summarize'}
              </TerminalButton>
            )}
            {isSaved && !savedItem.saved_to_obsidian && (
              <TerminalButton size="sm" onClick={() => handleSummarize(item.url, item)} disabled={isSummarizing || isSaving}>
                {isSummarizing ? 'thinking...' : 're-summarize'}
              </TerminalButton>
            )}
            {(!isSaved || !savedItem?.saved_to_obsidian) && (
              <TerminalButton size="sm" variant="amber" onClick={() => handleSaveToVault(item.url, item)} disabled={isSaving || isSummarizing}>
                {isSaving ? 'saving...' : 'save to vault'}
              </TerminalButton>
            )}
            {isSaved && savedItem.saved_to_obsidian && (
              <StatusTag variant="primary">IN VAULT</StatusTag>
            )}
            {showUnviewBtn && (
              <button onClick={() => unmarkViewed(item.url)} title="Move back to feed" className="cursor-pointer text-term-muted hover:text-term-primary">
                <EyeOff className="w-3.5 h-3.5" />
              </button>
            )}
            {goals.length > 0 && (
              <select
                defaultValue=""
                onChange={e => { attachToGoal(item, e.target.value); e.target.value = '' }}
                title="Add to a Learning Goal"
                className="font-term text-[10px] font-bold px-1.5 py-1 bg-term-bg border border-term-border text-term-primary cursor-pointer max-w-[90px]"
              >
                <option value="" disabled>+ goal</option>
                {goals.map((g: any) => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </TerminalWindow>
    )
  }

  // Row for an item in "My Saved Vault". A dense list uses bordered rows
  // rather than N full windowed cards — separate from FeedCard since saved
  // articles carry different fields (no timestamp/thumbnail, but do have
  // `related_articles` — the auto-linked notes the app found for you).
  const SavedItemCard = ({ item }: { item: any }) => (
    <div
      onClick={() => openSavedItem(item)}
      className="p-3 border border-term-border hover:border-term-primary transition-colors cursor-pointer group"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusTag variant={SOURCE_VARIANT[item.source] || 'muted'}>{item.source || 'WEB'}</StatusTag>
            {item.liked && <Heart className="w-3 h-3 fill-term-error text-term-error" />}
          </div>
          <h3 className="font-bold text-sm group-hover:text-term-primary transition-colors mb-1 line-clamp-1">{item.title}</h3>
          <p className="text-term-muted text-xs line-clamp-2">{item.summary}</p>
          {item.liked && item.notes && (() => {
            const notesOpen = expandedNotes.has(item.url)
            const actionItems = notesOpen ? extractActionItems(item.notes) : []
            return (
              <div onClick={e => e.stopPropagation()} className="mt-2">
                <button
                  onClick={() => setExpandedNotes(prev => {
                    const next = new Set(prev)
                    next.has(item.url) ? next.delete(item.url) : next.add(item.url)
                    return next
                  })}
                  className="font-term text-[10px] font-bold text-term-amber hover:text-term-primary cursor-pointer"
                >
                  {notesOpen ? '▾' : '▸'} // {notesOpen ? 'hide' : 'view'} ai_notes.md
                </button>
                {notesOpen && (
                  <div className="mt-2 p-3 bg-black border border-term-border">
                    <div className="term-prose">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.notes}</ReactMarkdown>
                    </div>
                    {goals.length > 0 && actionItems.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-dashed border-term-border space-y-1.5">
                        <p className="text-[10px] font-bold text-term-muted uppercase tracking-wide mb-1.5">$ quick_actions --list</p>
                        {actionItems.map((action, ai) => (
                          <div key={ai} className="flex items-center gap-2">
                            <p className="flex-1 text-xs text-term-primary/80 line-clamp-1">{'>'} {action}</p>
                            <select
                              defaultValue=""
                              onChange={e => { attachToGoal(item, e.target.value, action, `From notes on: ${item.title} (${item.url})`); e.target.value = '' }}
                              title="Add this action item to a Learning Goal"
                              className="font-term text-[10px] px-1.5 py-1 bg-term-bg border border-term-border text-term-primary cursor-pointer flex-shrink-0 max-w-[90px]"
                            >
                              <option value="" disabled>+ goal</option>
                              {goals.map((g: any) => (
                                <option key={g.id} value={g.id}>{g.title}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}
          {item.related_articles && (() => {
            let related: any[] = []
            try { related = JSON.parse(item.related_articles) } catch {}
            if (!related.length) return null
            const conceptOpen = expandedConcept.has(item.url)
            const concept = conceptNotes[item.id]
            return (
              <div onClick={e => e.stopPropagation()} className="mt-2 pt-2 border-t border-dashed border-term-border">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="font-term text-[10px] text-term-muted mr-1">link:</span>
                  {related.map((r: any) => (
                    <a
                      key={r.id}
                      href={r.url?.startsWith('http') ? r.url : undefined}
                      onClick={e => { if (!r.url?.startsWith('http')) e.preventDefault() }}
                      target="_blank"
                      rel="noreferrer"
                      className="font-term text-[10px] px-1.5 py-0.5 border border-term-border text-term-muted hover:text-term-primary hover:border-term-primary truncate max-w-[140px]"
                    >
                      {r.title}
                    </a>
                  ))}
                </div>
                <button
                  onClick={() => concept ? setExpandedConcept(prev => {
                    const next = new Set(prev)
                    next.has(item.url) ? next.delete(item.url) : next.add(item.url)
                    return next
                  }) : handleConsolidate(item)}
                  disabled={consolidating === item.id}
                  className="mt-1.5 font-term text-[10px] font-bold text-term-amber hover:text-term-primary disabled:opacity-50 cursor-pointer"
                >
                  {consolidating === item.id
                    ? 'synthesizing...'
                    : concept
                      ? `${conceptOpen ? '▾' : '▸'} // ${conceptOpen ? 'hide' : 'view'} concept_note.md`
                      : '$ consolidate --with-related'}
                </button>
                {concept && conceptOpen && (
                  <div className="mt-2 p-3 bg-black border border-term-amber/40">
                    <p className="font-term text-[10px] text-term-muted mb-2">source: {concept.source_titles.join(', ')}</p>
                    <div className="term-prose">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{concept.content}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )

  const totalUnfiltered = unviewedFeed.filter((item: any) => sourceFilter === 'All' || item.source === sourceFilter).length

  return (
    <div className="min-h-screen bg-term-bg text-term-primary p-6 font-term">
      {/* Toast notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 border font-bold text-sm max-w-sm bg-term-bg
          ${toast.type === 'error' ? 'border-term-error text-term-error' : 'border-term-primary text-term-primary'}`}>
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-auto text-term-muted hover:text-term-primary cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2 uppercase term-glow">
            <Terminal className="w-6 h-6" /> SRE_AI_OS<Blinker className="ml-0.5" />
          </h1>
          <p className="text-term-muted mt-1 text-xs">root@sre-ai-os:~$ status --dashboard</p>
        </div>
        <div className="flex items-center gap-2">
          <TerminalButton
            solid
            variant="amber"
            onClick={handleReflectNow}
            disabled={reflecting}
            title="Run the reflection agent now — proposes new goals from recent interests and flags liked items you've never revisited"
          >
            <span className="flex items-center gap-2">
              <Lightbulb className={`w-4 h-4 ${reflecting ? 'animate-pulse' : ''}`} />
              {reflecting ? 'reflecting...' : 'reflect now'}
            </span>
          </TerminalButton>
          <TerminalButton solid onClick={() => handleDiscover(true)} disabled={discovering}>
            <span className="flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 ${discovering ? 'animate-spin' : ''}`} />
              {discovering ? 'discovering...' : 'live search all topics'}
            </span>
          </TerminalButton>
        </div>
      </header>

      {/* Agent Suggestions inbox — proactive, human-reviewed proposals from
          the reflect loop. Nothing here was created without a review step. */}
      {suggestions.length > 0 && (
        <TerminalWindow title="AGENT_SUGGESTIONS" variant="amber" className="mb-6" noPadding>
          <div className="divide-y divide-dashed divide-term-border">
            {suggestions.map(s => (
              <div key={s.id} className="flex items-start gap-3 p-3">
                {s.type === 'new_goal'
                  ? <Target className="w-4 h-4 text-term-amber flex-shrink-0 mt-0.5" />
                  : <Lightbulb className="w-4 h-4 text-term-amber flex-shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">
                    <StatusTag variant="amber" className="mr-1.5">{s.type === 'new_goal' ? 'NEW GOAL' : 'OPEN LOOP'}</StatusTag>
                    {s.title}
                  </p>
                  <p className="text-xs text-term-muted mt-1">{s.description}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <TerminalButton size="sm" variant="muted" onClick={() => handleSuggestionAction(s, 'dismiss')} disabled={actingOn === s.id}>
                    dismiss
                  </TerminalButton>
                  <TerminalButton size="sm" variant="amber" onClick={() => handleSuggestionAction(s, 'accept')} disabled={actingOn === s.id}>
                    {s.type === 'new_goal' ? 'create goal' : 'revisit'}
                  </TerminalButton>
                </div>
              </div>
            ))}
          </div>
        </TerminalWindow>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: main feed ── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Feed tabs */}
          {liveFeed.length > 0 && (
            <TerminalWindow title="LIVE_FEED">
              {/* Tab row + controls */}
              <div className="flex flex-col gap-4 mb-5">
                <div className="flex items-center gap-1">
                  <TerminalButton size="sm" solid={activeTab === 'feed'} variant="primary" onClick={() => setActiveTab('feed')}>
                    feed ({unviewedFeed.length})
                  </TerminalButton>
                  <TerminalButton size="sm" solid={activeTab === 'viewed'} variant="muted" onClick={() => setActiveTab('viewed')}>
                    viewed{viewedFeed.length > 0 ? ` (${viewedFeed.length})` : ''}
                  </TerminalButton>
                </div>

                {/* Filters — only show on Feed tab */}
                {activeTab === 'feed' && (
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 flex-wrap">
                      {availableSources.map((source: any) => (
                        <TerminalButton
                          key={source}
                          size="sm"
                          solid={sourceFilter === source}
                          onClick={() => { setSourceFilter(source); setCurrentPage(1) }}
                        >
                          {source.toLowerCase()}
                        </TerminalButton>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-term-muted font-bold">sort:</span>
                      <select
                        value={sortBy}
                        onChange={e => { setSortBy(e.target.value); setCurrentPage(1) }}
                        className="font-term bg-term-bg border border-term-border p-1.5 text-xs text-term-primary focus:outline-none focus:border-term-primary cursor-pointer"
                      >
                        <option value="Newest">newest first</option>
                        <option value="Oldest">oldest first</option>
                        <option value="Balanced">balanced (mix topics)</option>
                        {goals.length > 0 && <option value="Relevant">relevant to my goals</option>}
                      </select>
                    </div>
                  </div>
                )}

                {activeTab === 'viewed' && viewedFeed.length > 0 && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-term-muted">{viewedFeed.length} articles you've opened. Click <EyeOff className="inline w-3 h-3" /> to move back to feed.</p>
                    <TerminalButton size="sm" variant="error" onClick={clearAllViewed}>
                      clear all
                    </TerminalButton>
                  </div>
                )}
              </div>

              {/* Feed content */}
              {activeTab === 'feed' && (
                <>
                  {displayedFeed.length === 0 ? (
                    <div className="text-center py-12 text-term-muted">
                      <Activity className="w-8 h-8 mx-auto mb-3 opacity-40" />
                      <p className="text-sm">no results. run `live search all topics` to discover content.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {displayedFeed.map((item: any, i) => (
                        <FeedCard key={i} item={item} />
                      ))}
                    </div>
                  )}
                  {displayedFeed.length < totalUnfiltered && (
                    <div className="flex justify-center mt-6">
                      <TerminalButton onClick={() => setCurrentPage(p => p + 1)}>
                        load more
                      </TerminalButton>
                    </div>
                  )}
                </>
              )}

              {activeTab === 'viewed' && (
                <>
                  {viewedFeed.length === 0 ? (
                    <div className="text-center py-12 text-term-muted">
                      <Eye className="w-8 h-8 mx-auto mb-3 opacity-40" />
                      <p className="text-sm">no viewed articles yet. articles you open will appear here.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {viewedFeed.map((item: any, i) => (
                        <FeedCard key={i} item={item} showUnviewBtn />
                      ))}
                    </div>
                  )}
                </>
              )}
            </TerminalWindow>
          )}

          {/* Saved Vault */}
          <TerminalWindow
            title="MY_SAVED_VAULT"
            titleRight={
              <input
                type="text"
                value={savedSearch}
                onChange={e => setSavedSearch(e.target.value)}
                placeholder="grep vault..."
                onClick={e => e.stopPropagation()}
                className="font-term normal-case font-normal bg-term-bg border border-term-bg text-term-bg px-2 py-1 text-xs focus:outline-none focus:border-term-bg w-40 placeholder:text-term-bg/60"
              />
            }
          >
            <div className="flex items-center gap-2 mb-4">
              <Bookmark className="w-4 h-4" />
              <span className="text-xs text-term-muted">{savedArticles.length} note{savedArticles.length === 1 ? '' : 's'} archived</span>
            </div>
            <div className="space-y-2">
              {savedSearch.trim() ? (
                searching ? (
                  <p className="text-term-muted text-sm">searching...</p>
                ) : (savedSearchResults?.length ?? 0) === 0 ? (
                  <p className="text-term-muted text-sm">no saved articles match &quot;{savedSearch}&quot;.</p>
                ) : (
                  savedSearchResults!.map((item: any, i) => <SavedItemCard key={i} item={item} />)
                )
              ) : savedArticles.length === 0 ? (
                <p className="text-term-muted text-sm">vault is empty. summarize an article to save it.</p>
              ) : (
                savedArticles.map((item: any, i) => <SavedItemCard key={i} item={item} />)
              )}
            </div>
          </TerminalWindow>
        </div>

        {/* ── Right: Quick Ingest ── */}
        <div className="space-y-6">
          <TerminalWindow title="QUICK_INGEST">
            <p className="text-xs text-term-muted mb-3 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-term-amber" /> paste a url to extract, summarize &amp; save instantly.</p>
            <TerminalPromptInput
              value={url}
              onChange={setUrl}
              onKeyDown={e => e.key === 'Enter' && handleQuickIngest()}
              placeholder="https://..."
              className="mb-3"
            />
            <TerminalButton solid variant="amber" onClick={handleQuickIngest} disabled={ingesting} className="w-full text-center">
              {ingesting ? 'summarizing...' : 'ingest to vault'}
            </TerminalButton>
          </TerminalWindow>

          <TerminalWindow title="AI_AGENT">
            <div className="flex items-center gap-1 mb-3">
              {[
                { key: 'research', label: 'research', icon: Sparkles },
                { key: 'runbook', label: 'runbook', icon: FileText },
              ].map(t => (
                <TerminalButton
                  key={t.key}
                  size="sm"
                  solid={agentMode === t.key}
                  onClick={() => setAgentMode(t.key as 'research' | 'runbook')}
                  className="flex-1"
                >
                  {t.label}
                </TerminalButton>
              ))}
            </div>
            <p className="text-xs text-term-muted mb-3">
              {agentMode === 'research'
                ? 'ask the research agent to investigate a topic — grounded in your own saved vault when relevant.'
                : 'describe an incident and get a structured runbook.'}
            </p>
            <textarea
              value={agentInput}
              onChange={e => setAgentInput(e.target.value)}
              placeholder={agentMode === 'research' ? 'e.g. kubernetes rbac best practices' : 'e.g. pod stuck in crashloopbackoff'}
              className="w-full bg-term-bg border border-term-border px-3 py-2.5 text-sm font-term focus:outline-none focus:border-term-primary text-term-primary placeholder:text-term-muted mb-3 min-h-[70px] resize-none"
            />
            <TerminalButton solid onClick={handleRunAgent} disabled={agentRunning || !agentInput.trim()} className="w-full text-center">
              {agentRunning ? 'working...' : agentMode === 'research' ? 'research & save' : 'generate runbook'}
            </TerminalButton>
            {agentResult && (
              <div className="mt-3 bg-black border border-term-border p-3 max-h-64 overflow-y-auto term-prose">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentResult}</ReactMarkdown>
              </div>
            )}
          </TerminalWindow>

          <TerminalWindow title="SECURITY_ADVISORIES" variant="error" titleRight={
            <button
              onClick={e => { e.stopPropagation(); handleRefreshCves() }}
              disabled={refreshingCves}
              title="Fetch recent CVEs matching your keywords"
              className="text-term-bg hover:opacity-70 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshingCves ? 'animate-spin' : ''}`} />
            </button>
          }>
            {cves.length === 0 ? (
              <p className="text-term-muted text-xs">no cves tracked yet. click refresh to pull recent ones matching your keywords.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {cves.map((c: any) => (
                  <a
                    key={c.cve_id}
                    href={`https://nvd.nist.gov/vuln/detail/${c.cve_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block p-2.5 border border-term-border hover:border-term-error transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-bold">{c.cve_id}</span>
                      <StatusTag variant={c.severity === 'CRITICAL' || c.severity === 'HIGH' ? 'error' : c.severity === 'MEDIUM' ? 'amber' : 'muted'}>
                        {c.severity}
                      </StatusTag>
                    </div>
                    <p className="text-term-muted text-xs line-clamp-2">{c.description}</p>
                  </a>
                ))}
              </div>
            )}
          </TerminalWindow>

          <TerminalWindow title="LEARNING_PATH">
            <p className="text-xs text-term-muted mb-4 flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5" /> track your sre goals and time in the learning path page.</p>
            <a href="/learning" className="block">
              <TerminalButton solid variant="amber" className="w-full text-center">
                open learning path →
              </TerminalButton>
            </a>
          </TerminalWindow>
        </div>
      </div>
    </div>
  )
}
