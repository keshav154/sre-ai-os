'use client'
import { useEffect, useState, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Network, RefreshCw, Info, MessageCircleQuestion, Send, Database } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface GraphNode {
  id: string
  label: string
  type: 'keyword' | 'article'
  url?: string
  source?: string
  val?: number
  x?: number
  y?: number
}

interface GraphLink {
  source: string
  target: string
}

interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

// Color map
const NODE_COLORS: Record<string, string> = {
  keyword: '#10b981',
  YouTube: '#ef4444',
  Medium: '#f59e0b',
  article: '#6366f1',
}

export default function KnowledgeGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const animRef = useRef<number>(0)
  const positionsRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map())

  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<{ title: string; url: string }[]>([])
  const [askStatus, setAskStatus] = useState('')
  const [reindexing, setReindexing] = useState(false)

  const handleAsk = async () => {
    if (!question.trim()) return
    setAsking(true)
    setAskStatus('')
    setAnswer('')
    setSources([])
    try {
      const res = await fetch(`${API}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim() })
      })
      const data = await res.json()
      if (!res.ok) {
        setAskStatus(data.detail || 'Failed to get an answer.')
      } else {
        setAnswer(data.answer)
        setSources(data.sources || [])
      }
    } catch (e) {
      setAskStatus('Failed to reach the backend.')
    }
    setAsking(false)
  }

  const handleReindex = async () => {
    setReindexing(true)
    try {
      const res = await fetch(`${API}/vault/reindex`, { method: 'POST' })
      const data = await res.json()
      setAskStatus(data.message || 'Reindexing started.')
    } catch (e) {
      setAskStatus('Failed to start reindexing.')
    }
    setReindexing(false)
  }

  const fetchGraph = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/graph`)
      const data = await res.json()
      setGraphData(data)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  useEffect(() => { fetchGraph() }, [])

  useEffect(() => {
    if (!graphData.nodes.length) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Initialize positions with force-directed layout seed
    const W = canvas.width
    const H = canvas.height
    const map = positionsRef.current

    graphData.nodes.forEach((node, i) => {
      if (!map.has(node.id)) {
        const angle = (i / graphData.nodes.length) * 2 * Math.PI
        const r = Math.min(W, H) * 0.3
        map.set(node.id, {
          x: W / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 80,
          y: H / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 80,
          vx: 0,
          vy: 0
        })
      }
    })

    let tick = 0

    const draw = () => {
      // Force-directed simulation
      const positions = positionsRef.current
      const nodes = graphData.nodes
      const links = graphData.links

      // Repulsion
      nodes.forEach(a => {
        const pa = positions.get(a.id)!
        nodes.forEach(b => {
          if (a.id === b.id) return
          const pb = positions.get(b.id)!
          const dx = pa.x - pb.x
          const dy = pa.y - pb.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = Math.min(3000 / (dist * dist), 5)
          pa.vx += (dx / dist) * force
          pa.vy += (dy / dist) * force
        })
      })

      // Attraction along links
      links.forEach(link => {
        const src = typeof link.source === 'object' ? (link.source as any).id : link.source
        const tgt = typeof link.target === 'object' ? (link.target as any).id : link.target
        const pa = positions.get(src)
        const pb = positions.get(tgt)
        if (!pa || !pb) return
        const dx = pb.x - pa.x
        const dy = pb.y - pa.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (dist - 120) * 0.03
        pa.vx += (dx / dist) * force
        pa.vy += (dy / dist) * force
        pb.vx -= (dx / dist) * force
        pb.vy -= (dy / dist) * force
      })

      // Center gravity
      nodes.forEach(node => {
        const p = positions.get(node.id)!
        p.vx += (W / 2 - p.x) * 0.003
        p.vy += (H / 2 - p.y) * 0.003
      })

      // Apply velocity with damping
      nodes.forEach(node => {
        const p = positions.get(node.id)!
        p.vx *= 0.85
        p.vy *= 0.85
        p.x = Math.max(30, Math.min(W - 30, p.x + p.vx))
        p.y = Math.max(30, Math.min(H - 30, p.y + p.vy))
      })

      // Render
      ctx.clearRect(0, 0, W, H)

      // Draw links
      links.forEach(link => {
        const src = typeof link.source === 'object' ? (link.source as any).id : link.source
        const tgt = typeof link.target === 'object' ? (link.target as any).id : link.target
        const pa = positions.get(src)
        const pb = positions.get(tgt)
        if (!pa || !pb) return
        ctx.beginPath()
        ctx.strokeStyle = 'rgba(52,211,153,0.2)'
        ctx.lineWidth = 1
        ctx.moveTo(pa.x, pa.y)
        ctx.lineTo(pb.x, pb.y)
        ctx.stroke()
      })

      // Draw nodes
      nodes.forEach(node => {
        const p = positions.get(node.id)!
        const isKeyword = node.type === 'keyword'
        const isHovered = hoveredNode?.id === node.id
        const r = isKeyword ? 18 : 10
        const color = isKeyword ? '#10b981' : (NODE_COLORS[node.source || ''] || '#6366f1')

        // Glow
        if (isKeyword || isHovered) {
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.5)
          grad.addColorStop(0, color + '55')
          grad.addColorStop(1, 'transparent')
          ctx.beginPath()
          ctx.fillStyle = grad
          ctx.arc(p.x, p.y, r * 2.5, 0, 2 * Math.PI)
          ctx.fill()
        }

        // Node circle
        ctx.beginPath()
        ctx.arc(p.x, p.y, isHovered ? r + 3 : r, 0, 2 * Math.PI)
        ctx.fillStyle = color
        ctx.fill()
        ctx.strokeStyle = isHovered ? '#fff' : color + 'aa'
        ctx.lineWidth = 2
        ctx.stroke()

        // Label
        ctx.fillStyle = isKeyword ? '#fff' : '#a1a1aa'
        ctx.font = isKeyword ? 'bold 11px Inter, sans-serif' : '9px Inter, sans-serif'
        ctx.textAlign = 'center'
        const label = node.label.length > 22 ? node.label.slice(0, 22) + '…' : node.label
        ctx.fillText(label, p.x, p.y + r + 12)
      })

      tick++
      animRef.current = requestAnimationFrame(draw)
    }

    animRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animRef.current)
  }, [graphData, hoveredNode])

  // Mouse interaction
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width)
    const my = (e.clientY - rect.top) * (canvas.height / rect.height)
    let found: GraphNode | null = null
    graphData.nodes.forEach(node => {
      const p = positionsRef.current.get(node.id)
      if (!p) return
      const r = node.type === 'keyword' ? 18 : 10
      if (Math.hypot(p.x - mx, p.y - my) < r + 4) found = node
    })
    setHoveredNode(found)
    canvas.style.cursor = found ? 'pointer' : 'default'
  }

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (hoveredNode) {
      setSelected(hoveredNode)
      if (hoveredNode.url) window.open(hoveredNode.url, '_blank')
    }
  }

  const total = graphData.nodes.length
  const keywords = graphData.nodes.filter(n => n.type === 'keyword').length
  const articles = total - keywords

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 p-6 font-sans flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold flex items-center gap-3">
            <Network className="text-purple-400 w-8 h-8" /> Knowledge Graph
          </h1>
          <p className="text-zinc-400 mt-1 text-sm">
            Interactive 2D map of your topics, articles &amp; connections
          </p>
        </div>
        <button
          onClick={fetchGraph}
          className="flex items-center gap-2 bg-purple-700 hover:bg-purple-600 px-4 py-2 rounded-lg font-bold transition-colors cursor-pointer text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      {/* Stats */}
      <div className="flex gap-4">
        {[
          { label: 'Topics', value: keywords, color: 'emerald' },
          { label: 'Articles', value: articles, color: 'indigo' },
          { label: 'Connections', value: graphData.links.length, color: 'purple' },
        ].map(s => (
          <div key={s.label} className={`bg-zinc-900 border border-${s.color}-900/40 rounded-xl px-5 py-3 flex flex-col items-center`}>
            <span className={`text-2xl font-extrabold text-${s.color}-400`}>{s.value}</span>
            <span className="text-xs text-zinc-500 mt-0.5">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-zinc-400">
        {[
          { color: '#10b981', label: 'Topic Keyword' },
          { color: '#ef4444', label: 'YouTube' },
          { color: '#f59e0b', label: 'Medium' },
          { color: '#6366f1', label: 'Article / Web' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ background: l.color }} />
            {l.label}
          </div>
        ))}
      </div>

      {/* Canvas */}
      <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden relative" style={{ minHeight: 520 }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-zinc-900/80">
            <div className="text-center">
              <RefreshCw className="w-8 h-8 text-purple-400 animate-spin mx-auto mb-3" />
              <p className="text-zinc-400">Building knowledge graph…</p>
            </div>
          </div>
        )}
        {!loading && graphData.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-zinc-500">
              <Info className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No articles ingested yet.</p>
              <p className="text-sm mt-1">Run Live Search on the dashboard to populate the graph.</p>
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={1400}
          height={700}
          className="w-full h-full"
          onMouseMove={handleMouseMove}
          onClick={handleClick}
        />
        {hoveredNode && (
          <div className="absolute bottom-4 left-4 bg-zinc-800/95 border border-zinc-700 rounded-lg px-4 py-2 text-xs max-w-xs backdrop-blur-sm">
            <p className="font-bold text-white">{hoveredNode.label}</p>
            {hoveredNode.source && <p className="text-zinc-400">{hoveredNode.source}</p>}
            {hoveredNode.url && <p className="text-purple-400 mt-0.5">Click to open →</p>}
          </div>
        )}
      </div>

      {/* Ask Your Vault (RAG chat) */}
      <div className="bg-zinc-900 border border-emerald-900/40 rounded-xl p-6">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <MessageCircleQuestion className="text-emerald-400 w-6 h-6" /> Ask Your Vault
          </h2>
          <button
            onClick={handleReindex}
            disabled={reindexing}
            title="Backfill embeddings for articles saved before semantic search existed"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-400 transition-colors cursor-pointer"
          >
            <Database className="w-3.5 h-3.5" /> {reindexing ? 'Starting...' : 'Reindex Vault'}
          </button>
        </div>
        <p className="text-zinc-400 text-sm mb-4">
          Ask a question across everything you've liked, summarized, or saved — answered using only your own notes, with citations.
        </p>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAsk()}
            placeholder="e.g. What have I learned about Kubernetes RBAC?"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            onClick={handleAsk}
            disabled={asking || !question.trim()}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-5 py-2.5 rounded-lg font-bold text-sm transition-colors cursor-pointer"
          >
            <Send className="w-4 h-4" /> {asking ? 'Thinking...' : 'Ask'}
          </button>
        </div>

        {askStatus && <p className="text-xs text-zinc-500 mb-3">{askStatus}</p>}

        {answer && (
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
            <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-headings:text-emerald-400 prose-a:text-blue-400">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
            </div>
            {sources.length > 0 && (
              <div className="mt-4 pt-3 border-t border-zinc-800 flex flex-wrap gap-2">
                {sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-emerald-400 transition-colors"
                  >
                    📄 {s.title}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
