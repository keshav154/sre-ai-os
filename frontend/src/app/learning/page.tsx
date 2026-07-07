'use client'
import { useState, useEffect, useMemo } from 'react'
import { apiFetch } from '@/lib/api'
import {
  GraduationCap, Target, Sparkles, Plus, Trash2, CheckCircle2, Circle,
  Clock, Calendar, BarChart2, ChevronDown, ChevronUp, Loader2, Trophy, BookOpen, Bell, AlarmClock, Repeat,
  Search, ExternalLink
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell
} from 'recharts'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899']

interface Resource {
  title: string
  url: string
  source: string
}

interface Step {
  id: number
  title: string
  description?: string
  completed: boolean
  order_index: number
  resources?: Resource[]
}

interface Goal {
  id: number
  title: string
  description?: string
  progress: number
  status: string
  color: string
  created_at: string
  steps: Step[]
}

interface TimeLog {
  id: number
  goal_id?: number
  goal_title?: string
  duration_minutes: number
  notes?: string
  log_date: string
}

interface CheckIn {
  id: string
  title: string
  description: string
  frequency: 'daily' | 'weekly' | 'monthly'
  time: string
  days: number[] // 0=Sun,1=Mon,...6=Sat
  goalId?: number
  lastChecked?: string
  streak: number
}

export default function LearningPath() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([])
  const [checkIns, setCheckIns] = useState<CheckIn[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('checkIns') || '[]') } catch { return [] }
  })
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [expandedGoal, setExpandedGoal] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'goals' | 'planner' | 'checkins'>('goals')

  // Forms
  const [newGoalTitle, setNewGoalTitle] = useState('')
  const [newGoalDesc, setNewGoalDesc] = useState('')
  const [generateTopic, setGenerateTopic] = useState('')
  const [logMinutes, setLogMinutes] = useState('')
  const [logGoalId, setLogGoalId] = useState<string>('')
  const [logNotes, setLogNotes] = useState('')
  const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0])
  const [savingLog, setSavingLog] = useState(false)
  const [newStepTexts, setNewStepTexts] = useState<Record<number, string>>({})

  const fetchAll = async () => {
    setLoading(true)
    try {
      const [gRes, tRes] = await Promise.all([
        apiFetch(`${API}/goals`).then(r => r.json()),
        apiFetch(`${API}/time-logs`).then(r => r.json()),
      ])
      setGoals(gRes)
      setTimeLogs(tRes)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  // ── Goals actions ──────────────────────────────────
  const createGoal = async () => {
    if (!newGoalTitle.trim()) return
    const color = COLORS[goals.length % COLORS.length]
    await apiFetch(`${API}/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newGoalTitle, description: newGoalDesc, color })
    })
    setNewGoalTitle(''); setNewGoalDesc('')
    fetchAll()
  }

  const deleteGoal = async (id: number) => {
    await apiFetch(`${API}/goals/${id}`, { method: 'DELETE' })
    fetchAll()
  }

  const toggleStep = async (stepId: number, completed: boolean) => {
    await apiFetch(`${API}/steps/${stepId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed })
    })
    fetchAll()
  }

  const addStep = async (goalId: number) => {
    const text = newStepTexts[goalId]?.trim()
    if (!text) return
    const steps = goals.find(g => g.id === goalId)?.steps || []
    await apiFetch(`${API}/goals/${goalId}/steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal_id: goalId, title: text, order_index: steps.length })
    })
    setNewStepTexts(prev => ({ ...prev, [goalId]: '' }))
    fetchAll()
  }

  const [findingResourcesFor, setFindingResourcesFor] = useState<number | null>(null)
  const findResources = async (goalId: number, stepId: number) => {
    setFindingResourcesFor(stepId)
    try {
      await apiFetch(`${API}/goals/${goalId}/steps/${stepId}/find-resources`, { method: 'POST' })
      fetchAll()
    } catch (e) { console.error(e) }
    setFindingResourcesFor(null)
  }

  const generatePath = async () => {
    if (!generateTopic.trim()) return
    setGenerating(true)
    try {
      const res = await apiFetch(`${API}/goals/ai-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: generateTopic })
      })
      if (!res.ok) {
        const err = await res.json()
        alert(`AI generation failed: ${err.detail || 'Unknown error'}`)
      } else {
        setGenerateTopic('')
        fetchAll()
      }
    } catch (e) {
      alert('AI generation failed. Check your LLM engine in Settings.')
    }
    setGenerating(false)
  }

  // ── Time logs ──────────────────────────────────────
  const logTime = async () => {
    if (!logMinutes || isNaN(Number(logMinutes))) return
    setSavingLog(true)
    const goal = goals.find(g => g.id === Number(logGoalId))
    await apiFetch(`${API}/time-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal_id: logGoalId ? Number(logGoalId) : null,
        goal_title: goal?.title || null,
        duration_minutes: Number(logMinutes),
        notes: logNotes,
        log_date: logDate
      })
    })
    setLogMinutes(''); setLogNotes(''); setLogGoalId('')
    setSavingLog(false)
    fetchAll()
  }

  const deleteLog = async (id: number) => {
    await apiFetch(`${API}/time-logs/${id}`, { method: 'DELETE' })
    fetchAll()
  }

  // ── Chart data: minutes per day for current month ──
  const monthlyChartData = useMemo(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const days: Record<number, number> = {}
    for (let d = 1; d <= daysInMonth; d++) days[d] = 0

    timeLogs.forEach(log => {
      const d = new Date(log.log_date)
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate()
        days[day] = (days[day] || 0) + log.duration_minutes
      }
    })
    return Object.entries(days).map(([day, mins]) => ({
      day: Number(day),
      minutes: mins,
      hours: +(mins / 60).toFixed(1)
    }))
  }, [timeLogs])

  const totalThisMonth = monthlyChartData.reduce((acc, d) => acc + d.minutes, 0)
  const totalHours = (totalThisMonth / 60).toFixed(1)
  const activeDays = monthlyChartData.filter(d => d.minutes > 0).length

  // ── Goal-breakdown chart ───────────────────────────
  const goalBreakdown = useMemo(() => {
    const map: Record<string, number> = {}
    timeLogs.forEach(log => {
      const label = log.goal_title || 'Uncategorized'
      map[label] = (map[label] || 0) + log.duration_minutes
    })
    return Object.entries(map).map(([name, mins]) => ({ name, hours: +(mins / 60).toFixed(1) }))
      .sort((a, b) => b.hours - a.hours).slice(0, 6)
  }, [timeLogs])

  const monthName = new Date().toLocaleString('default', { month: 'long', year: 'numeric' })

  if (loading) return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-yellow-400 animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 p-6 font-sans">
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold flex items-center gap-3">
          <GraduationCap className="text-yellow-400 w-8 h-8" /> Learning Roadmap
        </h1>
        <p className="text-zinc-400 mt-1">AI-powered personalized SRE career path + time tracker</p>
      </header>

      {/* Tabs */}
      <div className="flex gap-2 mb-8 border-b border-zinc-800 pb-0 overflow-x-auto">
        {[
          { key: 'goals', label: 'Learning Goals', icon: <Target className="w-4 h-4" /> },
          { key: 'planner', label: 'Monthly Planner', icon: <Calendar className="w-4 h-4" /> },
          { key: 'checkins', label: 'Schedule Check-ins', icon: <Bell className="w-4 h-4" /> },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-2 px-5 py-2.5 font-bold text-sm rounded-t-lg border-b-2 transition-all cursor-pointer whitespace-nowrap
              ${activeTab === tab.key
                ? 'border-yellow-400 text-yellow-400 bg-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ────────────── GOALS TAB ────────────── */}
      {activeTab === 'goals' && (
        <div className="space-y-6">
          {/* Add Goal + AI Generate */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Manual add */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <h2 className="font-bold text-lg mb-4 flex items-center gap-2"><Plus className="text-blue-400 w-5 h-5" /> Add New Goal</h2>
              <input
                value={newGoalTitle}
                onChange={e => setNewGoalTitle(e.target.value)}
                placeholder="Goal title (e.g. Master Kubernetes)"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3 text-sm"
              />
              <textarea
                value={newGoalDesc}
                onChange={e => setNewGoalDesc(e.target.value)}
                placeholder="Short description (optional)"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3 text-sm min-h-[60px]"
              />
              <button
                onClick={createGoal}
                className="w-full bg-blue-700 hover:bg-blue-600 py-2.5 rounded-lg font-bold text-sm transition-colors cursor-pointer"
              >
                Create Goal
              </button>
            </div>

            {/* AI Generate */}
            <div className="bg-zinc-900 border border-violet-900/40 rounded-xl p-5">
              <h2 className="font-bold text-lg mb-1 flex items-center gap-2"><Sparkles className="text-violet-400 w-5 h-5" /> AI Generate Roadmap</h2>
              <p className="text-xs text-zinc-500 mb-4">Type a topic and your AI engine will generate a structured 5-step learning roadmap, then search the web for real resources for each step. Takes under a minute.</p>
              <input
                value={generateTopic}
                onChange={e => setGenerateTopic(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && generatePath()}
                placeholder="e.g. eBPF for Observability, Prometheus, Helm"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500 mb-3 text-sm"
              />
              <button
                onClick={generatePath}
                disabled={generating}
                className="w-full bg-violet-700 hover:bg-violet-600 disabled:opacity-50 py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4" /> Generate with AI</>}
              </button>
            </div>
          </div>

          {/* Goals list */}
          {goals.length === 0 && (
            <div className="text-center text-zinc-600 py-16">
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>No goals yet. Add one above or generate with AI!</p>
            </div>
          )}

          <div className="space-y-4">
            {goals.map(goal => {
              const isExpanded = expandedGoal === goal.id
              const doneSteps = goal.steps.filter(s => s.completed).length
              return (
                <div key={goal.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-lg">
                  {/* Header */}
                  <div
                    className="flex items-center gap-4 p-5 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                    onClick={() => setExpandedGoal(isExpanded ? null : goal.id)}
                  >
                    <div className="w-3 h-12 rounded-full flex-shrink-0" style={{ background: goal.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-lg">{goal.title}</h3>
                        {goal.status === 'completed' && (
                          <span className="text-xs bg-emerald-900/50 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                            <Trophy className="w-3 h-3" /> Completed
                          </span>
                        )}
                      </div>
                      {goal.description && <p className="text-zinc-400 text-sm mt-0.5 truncate">{goal.description}</p>}
                      {/* Progress bar */}
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex-1 bg-zinc-800 rounded-full h-2">
                          <div
                            className="h-2 rounded-full transition-all"
                            style={{ width: `${goal.progress}%`, background: goal.color }}
                          />
                        </div>
                        <span className="text-xs text-zinc-400 font-bold whitespace-nowrap">{goal.progress}% · {doneSteps}/{goal.steps.length} steps</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={e => { e.stopPropagation(); deleteGoal(goal.id) }} className="p-2 text-zinc-600 hover:text-red-400 rounded-lg transition-colors cursor-pointer">
                        <Trash2 className="w-4 h-4" />
                      </button>
                      {isExpanded ? <ChevronUp className="w-5 h-5 text-zinc-500" /> : <ChevronDown className="w-5 h-5 text-zinc-500" />}
                    </div>
                  </div>

                  {/* Steps */}
                  {isExpanded && (
                    <div className="border-t border-zinc-800 p-5 space-y-2 bg-zinc-950/50">
                      {goal.steps.length === 0 && <p className="text-zinc-600 text-sm italic">No steps yet. Add one below.</p>}
                      {goal.steps.map((step, idx) => (
                        <div
                          key={step.id}
                          className="flex items-start gap-3 p-3 rounded-lg hover:bg-zinc-800/60 transition-colors group"
                        >
                          <button
                            onClick={() => toggleStep(step.id, !step.completed)}
                            className="mt-0.5 flex-shrink-0 cursor-pointer"
                          >
                            {step.completed
                              ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                              : <Circle className="w-5 h-5 text-zinc-600 group-hover:text-zinc-400" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className={`font-semibold text-sm ${step.completed ? 'line-through text-zinc-600' : 'text-zinc-200'}`}>
                              {idx + 1}. {step.title}
                            </p>
                            {step.description && <p className="text-xs text-zinc-500 mt-0.5">{step.description}</p>}

                            {step.resources && step.resources.length > 0 ? (
                              <div className="mt-2 space-y-1">
                                {step.resources.map((r, ri) => (
                                  <a
                                    key={ri}
                                    href={r.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 hover:underline truncate"
                                  >
                                    <ExternalLink className="w-3 h-3 flex-shrink-0" /> {r.title}
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <button
                                onClick={() => findResources(goal.id, step.id)}
                                disabled={findingResourcesFor === step.id}
                                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-yellow-400 disabled:opacity-50 mt-2 cursor-pointer"
                              >
                                <Search className={`w-3 h-3 ${findingResourcesFor === step.id ? 'animate-spin' : ''}`} />
                                {findingResourcesFor === step.id ? 'Searching...' : 'Find resources'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      {/* Add step */}
                      <div className="flex gap-2 mt-3 pt-3 border-t border-zinc-800">
                        <input
                          value={newStepTexts[goal.id] || ''}
                          onChange={e => setNewStepTexts(prev => ({ ...prev, [goal.id]: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && addStep(goal.id)}
                          placeholder="Add a step…"
                          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-yellow-500"
                        />
                        <button
                          onClick={() => addStep(goal.id)}
                          className="bg-yellow-700 hover:bg-yellow-600 px-3 py-2 rounded-lg font-bold text-sm cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ────────────── PLANNER TAB ────────────── */}
      {activeTab === 'planner' && (
        <div className="space-y-8">
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Hours This Month', value: `${totalHours}h`, icon: <Clock className="w-5 h-5" />, color: 'yellow' },
              { label: 'Active Days', value: activeDays, icon: <Calendar className="w-5 h-5" />, color: 'blue' },
              { label: 'Total Sessions', value: timeLogs.length, icon: <BarChart2 className="w-5 h-5" />, color: 'violet' },
              { label: 'Goals Tracking', value: goals.length, icon: <Target className="w-5 h-5" />, color: 'emerald' },
            ].map(s => (
              <div key={s.label} className={`bg-zinc-900 border border-${s.color}-900/40 rounded-xl p-4 flex items-center gap-4`}>
                <div className={`text-${s.color}-400`}>{s.icon}</div>
                <div>
                  <div className={`text-2xl font-extrabold text-${s.color}-400`}>{s.value}</div>
                  <div className="text-xs text-zinc-500">{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Log time */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h2 className="font-bold text-lg mb-4 flex items-center gap-2"><Clock className="text-yellow-400 w-5 h-5" /> Log Study Session</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Date</label>
                <input
                  type="date"
                  value={logDate}
                  onChange={e => setLogDate(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-yellow-500 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Duration (minutes)</label>
                <input
                  type="number"
                  min="1"
                  value={logMinutes}
                  onChange={e => setLogMinutes(e.target.value)}
                  placeholder="e.g. 45"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-yellow-500 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Goal (optional)</label>
                <select
                  value={logGoalId}
                  onChange={e => setLogGoalId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-yellow-500 text-sm cursor-pointer"
                >
                  <option value="">— Unlinked —</option>
                  {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Notes (optional)</label>
                <input
                  value={logNotes}
                  onChange={e => setLogNotes(e.target.value)}
                  placeholder="What did you study?"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-yellow-500 text-sm"
                />
              </div>
            </div>
            <button
              onClick={logTime}
              disabled={savingLog || !logMinutes}
              className="mt-4 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 px-6 py-2.5 rounded-lg font-bold text-sm flex items-center gap-2 cursor-pointer transition-colors"
            >
              {savingLog ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Log Session
            </button>
          </div>

          {/* Bar chart: daily hours */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h2 className="font-bold text-lg mb-6 flex items-center gap-2">
              <BarChart2 className="text-blue-400 w-5 h-5" /> {monthName} — Daily Study Time
            </h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyChartData} barSize={18}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="day" tick={{ fill: '#71717a', fontSize: 11 }} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} unit="h" />
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                  labelStyle={{ color: '#a1a1aa' }}
                  formatter={(val: any) => [`${val}h`, 'Study Time']}
                  labelFormatter={(l: any) => `Day ${l}`}
                />
                <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                  {monthlyChartData.map((entry, index) => (
                    <Cell key={index} fill={entry.hours > 0 ? '#facc15' : '#27272a'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Goal breakdown */}
          {goalBreakdown.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <h2 className="font-bold text-lg mb-6 flex items-center gap-2">
                <Target className="text-violet-400 w-5 h-5" /> Hours by Goal (All Time)
              </h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={goalBreakdown} layout="vertical" barSize={16}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#71717a', fontSize: 11 }} unit="h" />
                  <YAxis dataKey="name" type="category" width={160} tick={{ fill: '#a1a1aa', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                    formatter={(val: any) => [`${val}h`, 'Hours']}
                  />
                  <Bar dataKey="hours" radius={[0, 4, 4, 0]}>
                    {goalBreakdown.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Recent sessions */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h2 className="font-bold text-lg mb-4 flex items-center gap-2"><Clock className="text-emerald-400 w-5 h-5" /> Recent Sessions</h2>
            {timeLogs.length === 0 && (
              <p className="text-zinc-600 text-sm italic">No sessions logged yet.</p>
            )}
            <div className="space-y-2">
              {timeLogs.slice(0, 20).map(log => (
                <div key={log.id} className="flex items-center justify-between p-3 bg-zinc-950 rounded-lg border border-zinc-800 group">
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">{log.duration_minutes} min {log.goal_title ? `— ${log.goal_title}` : ''}</p>
                      {log.notes && <p className="text-xs text-zinc-500">{log.notes}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500">{new Date(log.log_date).toLocaleDateString()}</span>
                    <button onClick={() => deleteLog(log.id)} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all cursor-pointer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* ────────────── CHECK-INS TAB ────────────── */}
      {activeTab === 'checkins' && (
        <CheckInsTab goals={goals} checkIns={checkIns} setCheckIns={setCheckIns} />
      )}
    </div>
  )
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FREQ_COLORS: Record<string, string> = { daily: '#10b981', weekly: '#3b82f6', monthly: '#8b5cf6' }

function CheckInsTab({ goals, checkIns, setCheckIns }: {
  goals: any[]
  checkIns: any[]
  setCheckIns: (c: any[]) => void
}) {
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newFreq, setNewFreq] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [newTime, setNewTime] = useState('09:00')
  const [newDays, setNewDays] = useState<number[]>([1, 3, 5]) // Mon, Wed, Fri
  const [newGoalId, setNewGoalId] = useState<string>('')
  const [history, setHistory] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('checkInHistory') || '{}') } catch { return {} }
  })

  const save = (updated: any[]) => {
    setCheckIns(updated)
    localStorage.setItem('checkIns', JSON.stringify(updated))
  }

  const saveHistory = (h: Record<string, string[]>) => {
    setHistory(h)
    localStorage.setItem('checkInHistory', JSON.stringify(h))
  }

  const addCheckIn = () => {
    if (!newTitle.trim()) return
    const item = {
      id: Date.now().toString(),
      title: newTitle,
      description: newDesc,
      frequency: newFreq,
      time: newTime,
      days: newDays,
      goalId: newGoalId ? Number(newGoalId) : undefined,
      lastChecked: undefined,
      streak: 0
    }
    save([item, ...checkIns])
    setNewTitle(''); setNewDesc(''); setNewGoalId('')
  }

  const deleteCheckIn = (id: string) => save(checkIns.filter(c => c.id !== id))

  const markDone = (id: string) => {
    const today = new Date().toISOString().split('T')[0]
    const updated = checkIns.map(c => {
      if (c.id !== id) return c
      const alreadyDoneToday = (history[id] || []).includes(today)
      if (alreadyDoneToday) return c
      return { ...c, lastChecked: today, streak: c.streak + 1 }
    })
    save(updated)
    const todayHistory = { ...history, [id]: [...(history[id] || []), today] }
    saveHistory(todayHistory)
  }

  const isDoneToday = (id: string) => {
    const today = new Date().toISOString().split('T')[0]
    return (history[id] || []).includes(today)
  }

  const toggleDay = (day: number) => {
    setNewDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
  }

  const totalStreaks = checkIns.reduce((acc, c) => acc + c.streak, 0)
  const doneToday = checkIns.filter(c => isDoneToday(c.id)).length

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Check-ins', value: checkIns.length, icon: <Bell className="w-5 h-5" />, color: 'yellow' },
          { label: 'Done Today', value: `${doneToday}/${checkIns.length}`, icon: <CheckCircle2 className="w-5 h-5" />, color: 'emerald' },
          { label: 'Total Streaks', value: totalStreaks, icon: <Repeat className="w-5 h-5" />, color: 'blue' },
          { label: 'Goals Linked', value: checkIns.filter(c => c.goalId).length, icon: <Target className="w-5 h-5" />, color: 'violet' },
        ].map(s => (
          <div key={s.label} className={`bg-zinc-900 border border-${s.color}-900/40 rounded-xl p-4 flex items-center gap-3`}>
            <div className={`text-${s.color}-400`}>{s.icon}</div>
            <div>
              <div className={`text-2xl font-extrabold text-${s.color}-400`}>{s.value}</div>
              <div className="text-xs text-zinc-500">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Add new check-in */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="font-bold text-lg mb-4 flex items-center gap-2"><Plus className="text-yellow-400 w-5 h-5" /> Schedule a Check-in</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Title *</label>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="e.g. Review SRE metrics"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-yellow-500" />
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Description</label>
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
              placeholder="What to do during this check-in"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-yellow-500" />
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Frequency</label>
            <select value={newFreq} onChange={e => setNewFreq(e.target.value as any)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-yellow-500 cursor-pointer">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Time</label>
            <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-yellow-500" />
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Linked Goal (optional)</label>
            <select value={newGoalId} onChange={e => setNewGoalId(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-yellow-500 cursor-pointer">
              <option value="">— None —</option>
              {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>
          {newFreq === 'weekly' && (
            <div>
              <label className="text-xs text-zinc-500 mb-2 block">Days of Week</label>
              <div className="flex gap-2 flex-wrap">
                {DAY_LABELS.map((d, i) => (
                  <button key={i} onClick={() => toggleDay(i)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer
                      ${newDays.includes(i) ? 'bg-yellow-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <button onClick={addCheckIn}
          className="mt-4 bg-yellow-600 hover:bg-yellow-500 px-6 py-2.5 rounded-lg font-bold text-sm cursor-pointer transition-colors flex items-center gap-2">
          <AlarmClock className="w-4 h-4" /> Schedule Check-in
        </button>
      </div>

      {/* Check-ins list */}
      {checkIns.length === 0 && (
        <div className="text-center py-16 text-zinc-600">
          <Bell className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>No check-ins scheduled. Add one above!</p>
        </div>
      )}

      <div className="space-y-3">
        {checkIns.map(ci => {
          const done = isDoneToday(ci.id)
          const linkedGoal = goals.find(g => g.id === ci.goalId)
          const freqColor = FREQ_COLORS[ci.frequency]
          return (
            <div key={ci.id} className={`bg-zinc-900 border rounded-xl p-5 flex items-start justify-between gap-4 transition-all
              ${done ? 'border-emerald-900/50 bg-emerald-950/10' : 'border-zinc-800'}`}>
              <div className="flex items-start gap-4 flex-1 min-w-0">
                <button onClick={() => markDone(ci.id)}
                  className={`mt-0.5 flex-shrink-0 cursor-pointer transition-colors ${done ? 'text-emerald-400' : 'text-zinc-600 hover:text-yellow-400'}`}>
                  {done ? <CheckCircle2 className="w-6 h-6" /> : <Circle className="w-6 h-6" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className={`font-bold text-base ${done ? 'line-through text-zinc-500' : ''}`}>{ci.title}</h3>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ background: freqColor }}>
                      {ci.frequency}
                    </span>
                    {done && <span className="text-xs bg-emerald-900/50 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded-full font-bold">✓ Done today</span>}
                  </div>
                  {ci.description && <p className="text-xs text-zinc-500 mb-2">{ci.description}</p>}
                  <div className="flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {ci.time}</span>
                    {ci.frequency === 'weekly' && ci.days?.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {ci.days.map((d: number) => DAY_LABELS[d]).join(', ')}
                      </span>
                    )}
                    {linkedGoal && (
                      <span className="flex items-center gap-1"><Target className="w-3 h-3" /> {linkedGoal.title}</span>
                    )}
                    {ci.streak > 0 && (
                      <span className="flex items-center gap-1 text-yellow-400 font-bold">🔥 {ci.streak} streak</span>
                    )}
                  </div>
                </div>
              </div>
              <button onClick={() => deleteCheckIn(ci.id)}
                className="text-zinc-600 hover:text-red-400 transition-colors cursor-pointer flex-shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
