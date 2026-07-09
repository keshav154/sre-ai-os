'use client'
import { useEffect, useState, useRef } from 'react'
import { apiFetch } from '@/lib/api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Network, RefreshCw, Info, MessageCircleQuestion, Send, Database, Brain, X } from 'lucide-react'
import { TerminalWindow, TerminalButton, StatusTag, Blinker } from '@/components/terminal'

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

// Color map — kept to the terminal palette (green/amber/error) plus a
// neutral off-white for generic article/web nodes, since these colors are
// functional (distinguish node types), not decorative.
const NODE_COLORS: Record<string, string> = {
  keyword: '#33ff00',
  YouTube: '#ff3333',
  Medium: '#ffb000',
  article: '#d4d4d4',
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

  const [memories, setMemories] = useState<any[]>([])
  const [forgetting, setForgetting] = useState<number | null>(null)

  const fetchMemories = async () => {
    try {
      const res = await apiFetch(`${API}/memory`)
      setMemories(await res.json())
    } catch (e) { console.error(e) }
  }

  const forgetMemory = async (id: number) => {
    setForgetting(id)
    try {
      await apiFetch(`${API}/memory/${id}`, { method: 'DELETE' })
      setMemories(prev => prev.filter(m => m.id !== id))
    } catch (e) { console.error(e) }
    setForgetting(null)
  }

  useEffect(() => { fetchMemories() }, [])

  const handleAsk = async () => {
    if (!question.trim()) return
    setAsking(true)
    setAskStatus('')
    setAnswer('')
    setSources([])
    try {
      const res = await apiFetch(`${API}/ask`, {
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
      const res = await apiFetch(`${API}/vault/reindex`, { method: 'POST' })
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
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/graph`)
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
        ctx.strokeStyle = 'rgba(51,255,0,0.15)'
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
        const color = isKeyword ? '#33ff00' : (NODE_COLORS[node.source || ''] || '#d4d4d4')

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

        // Node square (no rounded shapes — terminal glyph aesthetic)
        ctx.beginPath()
        ctx.arc(p.x, p.y, isHovered ? r + 3 : r, 0, 2 * Math.PI)
        ctx.fillStyle = color
        ctx.fill()
        ctx.strokeStyle = isHovered ? '#fff' : color + 'aa'
        ctx.lineWidth = 2
        ctx.stroke()

        // Label
        ctx.fillStyle = isKeyword ? '#fff' : '#a8f090'
        ctx.font = isKeyword ? 'bold 11px "JetBrains Mono", monospace' : '9px "JetBrains Mono", monospace'
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
    <div className="min-h-screen bg-term-bg text-term-primary p-6 font-term flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2 uppercase term-glow">
            <Network className="w-6 h-6" /> KNOWLEDGE_GRAPH<Blinker className="ml-0.5" />
          </h1>
          <p className="text-term-muted mt-1 text-xs">
            root@sre-ai-os:~$ map --topics --articles --connections
          </p>
        </div>
        <TerminalButton solid onClick={fetchGraph}>
          <span className="flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> refresh
          </span>
        </TerminalButton>
      </header>

      {/* Stats */}
      <div className="flex gap-4 flex-wrap">
        {[
          { label: 'Topics', value: keywords, variant: 'primary' as const },
          { label: 'Articles', value: articles, variant: 'muted' as const },
          { label: 'Connections', value: graphData.links.length, variant: 'amber' as const },
        ].map(s => (
          <div key={s.label} className="border border-term-border px-5 py-3 flex flex-col items-center">
            <span className={`text-2xl font-extrabold ${s.variant === 'primary' ? 'text-term-primary' : s.variant === 'amber' ? 'text-term-amber' : 'text-term-muted'}`}>{s.value}</span>
            <span className="text-[10px] text-term-muted mt-0.5 uppercase tracking-wide">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-term-muted flex-wrap">
        {[
          { color: '#33ff00', label: 'Topic Keyword' },
          { color: '#ff3333', label: 'YouTube' },
          { color: '#ffb000', label: 'Medium' },
          { color: '#d4d4d4', label: 'Article / Web' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5" style={{ background: l.color }} />
            {l.label}
          </div>
        ))}
      </div>

      {/* Canvas */}
      <TerminalWindow noPadding className="flex-1 overflow-hidden relative">
        <div className="relative" style={{ minHeight: 520 }}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-term-bg/90">
              <div className="text-center">
                <RefreshCw className="w-8 h-8 text-term-primary animate-spin mx-auto mb-3" />
                <p className="text-term-muted text-sm">building knowledge graph…</p>
              </div>
            </div>
          )}
          {!loading && graphData.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-term-muted">
                <Info className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>no articles ingested yet.</p>
                <p className="text-sm mt-1">run live search on the dashboard to populate the graph.</p>
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
            <div className="absolute bottom-4 left-4 bg-term-bg border border-term-border px-4 py-2 text-xs max-w-xs">
              <p className="font-bold text-term-primary">{hoveredNode.label}</p>
              {hoveredNode.source && <p className="text-term-muted">{hoveredNode.source}</p>}
              {hoveredNode.url && <p className="text-term-amber mt-0.5">click to open →</p>}
            </div>
          )}
        </div>
      </TerminalWindow>

      {/* Agent Memory — transparency into what the agents have inferred
          about you over time from the reflect loop, with the ability to
          delete anything you don't want it remembering. */}
      {memories.length > 0 && (
        <TerminalWindow title="AGENT_MEMORY" variant="amber">
          <p className="text-term-muted text-xs mb-4 flex items-center gap-1.5">
            <Brain className="w-3.5 h-3.5 text-term-amber" /> what the agents have learned about your interests and habits from your activity, used to inform research agent answers, liked-item notes, and weekly reflections. delete anything you don't want remembered.
          </p>
          <div className="space-y-2">
            {memories.map(m => (
              <div key={m.id} className="flex items-start gap-3 border border-term-border px-4 py-2.5">
                <StatusTag variant="amber" className="flex-shrink-0 mt-0.5">{m.category}</StatusTag>
                <p className="flex-1 text-sm text-term-primary/90">{m.content}</p>
                <button
                  onClick={() => forgetMemory(m.id)}
                  disabled={forgetting === m.id}
                  title="Forget this"
                  className="text-term-muted hover:text-term-error disabled:opacity-50 cursor-pointer flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </TerminalWindow>
      )}

      {/* Ask Your Vault (RAG chat) */}
      <TerminalWindow
        title="ASK_YOUR_VAULT"
        titleRight={
          <button
            onClick={e => { e.stopPropagation(); handleReindex() }}
            disabled={reindexing}
            title="Backfill embeddings for articles saved before semantic search existed"
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-term-bg hover:opacity-70 disabled:opacity-50 cursor-pointer"
          >
            <Database className="w-3 h-3" /> {reindexing ? 'starting...' : 'reindex vault'}
          </button>
        }
      >
        <p className="text-term-muted text-xs mb-4 flex items-center gap-1.5">
          <MessageCircleQuestion className="w-3.5 h-3.5" /> ask a question across everything you've liked, summarized, or saved — answered using only your own notes, with citations.
        </p>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAsk()}
            placeholder="e.g. what have I learned about kubernetes rbac?"
            className="flex-1 bg-term-bg border border-term-border px-4 py-2.5 text-sm font-term text-term-primary placeholder:text-term-muted focus:outline-none focus:border-term-primary"
          />
          <TerminalButton solid onClick={handleAsk} disabled={asking || !question.trim()}>
            <span className="flex items-center gap-2">
              <Send className="w-4 h-4" /> {asking ? 'thinking...' : 'ask'}
            </span>
          </TerminalButton>
        </div>

        {askStatus && <p className="text-xs text-term-muted mb-3">{askStatus}</p>}

        {answer && (
          <div className="bg-black border border-term-border p-4">
            <div className="term-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
            </div>
            {sources.length > 0 && (
              <div className="mt-4 pt-3 border-t border-dashed border-term-border flex flex-wrap gap-2">
                {sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-bold px-2 py-1 border border-term-border text-term-muted hover:text-term-primary hover:border-term-primary transition-colors"
                  >
                    &gt; {s.title}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </TerminalWindow>
    </div>
  )
}
