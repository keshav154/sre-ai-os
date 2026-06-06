'use client'
import { useState, useEffect, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BookOpen, Activity, Zap, RefreshCw, Terminal, CheckCircle2, Bookmark, Eye, EyeOff, X, AlertCircle } from "lucide-react"

const API = 'http://localhost:8000'

export default function Dashboard() {
  const [savedArticles, setSavedArticles] = useState([])
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

  const displayedFeed = useMemo(() => {
    let filtered = [...unviewedFeed]
    if (sourceFilter !== 'All') {
      filtered = filtered.filter((item: any) => item.source === sourceFilter)
    }
    if (sortBy === 'Newest') {
      filtered.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0))
    } else if (sortBy === 'Oldest') {
      filtered.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0))
    }
    return filtered.slice(0, currentPage * itemsPerPage)
  }, [unviewedFeed, currentPage, sourceFilter, sortBy])

  const fetchSavedArticles = async () => {
    try {
      const res = await fetch(`${API}/articles`)
      const data = await res.json()
      setSavedArticles(data)
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    fetchSavedArticles()
    const cachedFeed = localStorage.getItem('liveFeed')
    if (cachedFeed) {
      try { setLiveFeed(JSON.parse(cachedFeed)) } catch {}
    } else {
      handleDiscover()
    }
  }, [])

  const handleDiscover = async () => {
    setDiscovering(true)
    localStorage.removeItem('liveFeed')
    try {
      const res = await fetch(`${API}/discover`)
      const data = await res.json()
      setLiveFeed(data)
      setCurrentPage(1)
      localStorage.setItem('liveFeed', JSON.stringify(data))
    } catch (e) { console.error(e) }
    setDiscovering(false)
  }

  const handleSummarize = async (targetUrl: string) => {
    setProcessingAction({ url: targetUrl, action: 'summarize' })
    try {
      const res = await fetch(`${API}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl })
      })
      if (!res.ok) {
        const err = await res.json()
        showToast(err.detail || 'Summarization failed')
      }
      fetchSavedArticles()
    } catch (e) { console.error(e) }
    setProcessingAction(null)
  }

  const handleSaveToVault = async (targetUrl: string) => {
    setProcessingAction({ url: targetUrl, action: 'save' })
    try {
      const res = await fetch(`${API}/save-to-vault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl })
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

  const handleQuickIngest = async () => {
    if (!url) return
    setIngesting(true)
    await handleSummarize(url)
    setUrl('')
    setIngesting(false)
  }

  // Open article and mark as viewed
  const openItem = (item: any) => {
    window.open(item.url, '_blank')
    markAsViewed(item.url)
  }

  const FeedCard = ({ item, showUnviewBtn = false }: { item: any; showUnviewBtn?: boolean }) => {
    const savedItem = savedArticlesMap.get(item.url)
    const isSaved = !!savedItem
    const isSummarizing = processingAction?.url === item.url && processingAction.action === 'summarize'
    const isSaving = processingAction?.url === item.url && processingAction.action === 'save'
    const isViewed = viewedUrls.has(item.url)

    return (
      <div
        className={`flex flex-col bg-zinc-950 rounded-xl border transition-all group cursor-pointer h-full relative
          ${isViewed ? 'border-zinc-700/50 opacity-75' : 'border-zinc-800 hover:border-emerald-800/50'}
        `}
        onClick={() => openItem(item)}
      >
        {/* Viewed badge */}
        {isViewed && (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-zinc-800 rounded-full px-2 py-0.5 text-xs text-zinc-500">
            <Eye className="w-3 h-3" /> Viewed
          </div>
        )}

        {item.thumbnail && (
          <div className="w-full h-36 rounded-t-xl overflow-hidden bg-zinc-900 relative flex-shrink-0">
            <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
          </div>
        )}

        <div className="flex-1 flex flex-col p-4">
          <div className="mb-2">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-md 
                ${item.source === 'YouTube' ? 'bg-red-500/20 text-red-400' :
                  item.source === 'Medium' ? 'bg-amber-500/20 text-amber-400' :
                  'bg-blue-500/20 text-blue-400'}`}>
                {item.source}
              </span>
              {item.date_str && (
                <span className="text-xs text-zinc-500">{item.date_str}</span>
              )}
            </div>
            <h3 className="font-semibold text-sm leading-snug group-hover:text-emerald-400 transition-colors line-clamp-2">{item.title}</h3>
          </div>

          <div className={`text-xs mb-4 flex-1 ${isSaved ? 'text-zinc-300' : 'text-zinc-600 italic line-clamp-3'} prose prose-invert prose-p:leading-snug prose-headings:text-emerald-400 prose-a:text-blue-400 prose-sm max-w-none`}>
            {isSaved ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{savedItem.summary}</ReactMarkdown>
            ) : (
              item.summary
            )}
          </div>

          <div className="mt-auto flex gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
            {!isSaved && (
              <button
                onClick={() => handleSummarize(item.url)}
                disabled={isSummarizing || isSaving}
                className="flex-1 text-xs px-2 py-1.5 rounded-md font-bold bg-blue-700 hover:bg-blue-600 text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                {isSummarizing ? 'Thinking...' : '✨ AI Summarize'}
              </button>
            )}
            {isSaved && !savedItem.saved_to_obsidian && (
              <button
                onClick={() => handleSummarize(item.url)}
                disabled={isSummarizing || isSaving}
                className="flex-1 text-xs px-2 py-1.5 rounded-md font-bold bg-blue-700 hover:bg-blue-600 text-white transition-colors cursor-pointer"
              >
                {isSummarizing ? 'Thinking...' : 'Re-Summarize'}
              </button>
            )}
            {(!isSaved || !savedItem?.saved_to_obsidian) && (
              <button
                onClick={() => handleSaveToVault(item.url)}
                disabled={isSaving || isSummarizing}
                className="flex-1 text-xs px-2 py-1.5 rounded-md font-bold bg-emerald-700 hover:bg-emerald-600 text-white transition-colors cursor-pointer"
              >
                {isSaving ? 'Saving...' : '🔒 Save to Vault'}
              </button>
            )}
            {isSaved && savedItem.saved_to_obsidian && (
              <button disabled className="flex-1 text-xs px-2 py-1.5 rounded-md font-bold bg-zinc-800 text-zinc-500 cursor-not-allowed">
                ✓ In Vault
              </button>
            )}
            {showUnviewBtn && (
              <button
                onClick={() => unmarkViewed(item.url)}
                className="text-xs px-2 py-1.5 rounded-md font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors cursor-pointer"
                title="Move back to feed"
              >
                <EyeOff className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const totalUnfiltered = unviewedFeed.filter((item: any) => sourceFilter === 'All' || item.source === sourceFilter).length

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 p-6 font-sans">
      {/* Toast notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border font-semibold text-sm max-w-sm backdrop-blur-sm transition-all
          ${toast.type === 'error'
            ? 'bg-red-950/90 border-red-800 text-red-300'
            : 'bg-emerald-950/90 border-emerald-800 text-emerald-300'}`}>
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-auto text-zinc-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-3">
            <Terminal className="w-7 h-7 text-emerald-400" /> SRE AI OS
          </h1>
          <p className="text-zinc-500 mt-1 text-sm">Operational intelligence dashboard</p>
        </div>
        <button
          onClick={handleDiscover}
          disabled={discovering}
          className="bg-emerald-700 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-lg flex items-center gap-2 text-sm font-bold transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${discovering ? 'animate-spin' : ''}`} />
          {discovering ? 'Discovering...' : 'Live Search All Topics'}
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: main feed ── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Feed tabs */}
          {liveFeed.length > 0 && (
            <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl">
              {/* Tab row + controls */}
              <div className="flex flex-col gap-4 mb-5">
                <div className="flex items-center gap-2 border-b border-zinc-800 pb-0">
                  <button
                    onClick={() => setActiveTab('feed')}
                    className={`flex items-center gap-1.5 px-4 py-2.5 font-bold text-sm rounded-t-lg border-b-2 transition-all cursor-pointer
                      ${activeTab === 'feed' ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                  >
                    <Activity className="w-4 h-4" /> Feed
                    <span className="ml-1 bg-zinc-800 text-zinc-400 text-xs px-1.5 py-0.5 rounded-full">{unviewedFeed.length}</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('viewed')}
                    className={`flex items-center gap-1.5 px-4 py-2.5 font-bold text-sm rounded-t-lg border-b-2 transition-all cursor-pointer
                      ${activeTab === 'viewed' ? 'border-zinc-400 text-zinc-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                  >
                    <Eye className="w-4 h-4" /> Viewed
                    {viewedFeed.length > 0 && (
                      <span className="ml-1 bg-zinc-700 text-zinc-300 text-xs px-1.5 py-0.5 rounded-full">{viewedFeed.length}</span>
                    )}
                  </button>
                </div>

                {/* Filters — only show on Feed tab */}
                {activeTab === 'feed' && (
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 flex-wrap">
                      {availableSources.map((source: any) => (
                        <button
                          key={source}
                          onClick={() => { setSourceFilter(source); setCurrentPage(1) }}
                          className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-colors cursor-pointer
                            ${sourceFilter === source
                              ? 'bg-emerald-600 text-white'
                              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}`}
                        >
                          {source}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-zinc-500 font-bold">Sort:</span>
                      <select
                        value={sortBy}
                        onChange={e => { setSortBy(e.target.value); setCurrentPage(1) }}
                        className="bg-zinc-950 border border-zinc-800 rounded-lg p-1.5 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                      >
                        <option value="Newest">Newest First</option>
                        <option value="Oldest">Oldest First</option>
                      </select>
                    </div>
                  </div>
                )}

                {activeTab === 'viewed' && viewedFeed.length > 0 && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-zinc-500">{viewedFeed.length} articles you've opened. Click <EyeOff className="inline w-3 h-3" /> to move back to feed.</p>
                    <button
                      onClick={clearAllViewed}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <X className="w-3 h-3" /> Clear All
                    </button>
                  </div>
                )}
              </div>

              {/* Feed content */}
              {activeTab === 'feed' && (
                <>
                  {displayedFeed.length === 0 ? (
                    <div className="text-center py-12 text-zinc-600">
                      <Activity className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p>No results. Click "Live Search All Topics" to discover content.</p>
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
                      <button
                        onClick={() => setCurrentPage(p => p + 1)}
                        className="px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-bold rounded-full transition-colors cursor-pointer text-sm"
                      >
                        Load More
                      </button>
                    </div>
                  )}
                </>
              )}

              {activeTab === 'viewed' && (
                <>
                  {viewedFeed.length === 0 ? (
                    <div className="text-center py-12 text-zinc-600">
                      <Eye className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p>No viewed articles yet. Articles you open will appear here.</p>
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
            </section>
          )}

          {/* Saved Vault */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
              <Bookmark className="text-blue-400 w-5 h-5" /> My Saved Vault
            </h2>
            <div className="space-y-3">
              {savedArticles.length === 0 ? (
                <p className="text-zinc-600 text-sm">Your vault is empty. Summarize an article to save it.</p>
              ) : (
                savedArticles.map((item: any, i) => (
                  <div
                    key={i}
                    onClick={() => window.open(item.url, '_blank')}
                    className="flex items-start gap-3 p-4 bg-zinc-950 rounded-lg border border-zinc-800 hover:border-blue-800/50 transition-colors cursor-pointer group"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-md mb-2 inline-block bg-blue-500/20 text-blue-400">{item.source || 'Web'}</span>
                      <h3 className="font-semibold text-sm group-hover:text-blue-400 transition-colors mb-1 line-clamp-1">{item.title}</h3>
                      <p className="text-zinc-500 text-xs line-clamp-2">{item.summary}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* ── Right: Quick Ingest ── */}
        <div className="space-y-6">
          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-3">
              <Zap className="text-yellow-400 w-5 h-5" /> Quick Ingest
            </h2>
            <p className="text-xs text-zinc-500 mb-3">Paste a URL to extract, summarize &amp; save instantly.</p>
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleQuickIngest()}
              placeholder="https://..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/50 text-zinc-100 mb-3"
            />
            <button
              onClick={handleQuickIngest}
              disabled={ingesting}
              className="w-full bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 py-2.5 rounded-lg font-bold text-sm transition-colors cursor-pointer"
            >
              {ingesting ? 'Summarizing...' : 'Ingest to Vault'}
            </button>
          </section>

          <section className="bg-gradient-to-br from-indigo-900/40 to-purple-900/40 border border-indigo-500/30 rounded-xl p-5">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-2 text-indigo-200">
              <BookOpen className="text-indigo-400 w-5 h-5" /> Learning Path
            </h2>
            <p className="text-xs text-indigo-300/60 mb-4">Track your SRE goals and time in the Learning Path page.</p>
            <a
              href="/learning"
              className="block w-full text-center py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-bold transition-colors"
            >
              Open Learning Path →
            </a>
          </section>
        </div>
      </div>
    </div>
  )
}
