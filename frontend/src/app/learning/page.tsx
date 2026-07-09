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
import { TerminalWindow, TerminalButton, TerminalPromptInput, StatusTag, Blinker } from '@/components/terminal'

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

const TAB_ITEMS = [
  { key: 'goals', label: 'learning goals', icon: Target },
  { key: 'planner', label: 'monthly planner', icon: Calendar },
  { key: 'checkins', label: 'schedule check-ins', icon: Bell },
] as const

const CHART_GRID = '#1f521f'
const CHART_TICK = { fill: '#4a8f3a', fontSize: 11, fontFamily: 'var(--font-term)' }
const CHART_TOOLTIP_STYLE = { background: '#0a0a0a', border: '1px solid #1f521f', borderRadius: 0, fontFamily: 'var(--font-term)' }

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
    <div className="min-h-screen bg-term-bg flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-term-primary animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen bg-term-bg text-term-primary p-6 font-term">
      <header className="mb-8">
        <h1 className="text-2xl font-extrabold flex items-center gap-2 uppercase term-glow">
          <GraduationCap className="w-6 h-6" /> LEARNING_ROADMAP<Blinker className="ml-0.5" />
        </h1>
        <p className="text-term-muted mt-1 text-xs">ai-powered personalized sre career path + time tracker</p>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 mb-8 flex-wrap">
        {TAB_ITEMS.map(tab => (
          <TerminalButton
            key={tab.key}
            solid={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className="flex items-center gap-2">
              <tab.icon className="w-3.5 h-3.5" /> {tab.label}
            </span>
          </TerminalButton>
        ))}
      </div>

      {/* ────────────── GOALS TAB ────────────── */}
      {activeTab === 'goals' && (
        <div className="space-y-6">
          {/* Add Goal + AI Generate */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Manual add */}
            <TerminalWindow title="ADD_NEW_GOAL">
              <TerminalPromptInput
                value={newGoalTitle}
                onChange={setNewGoalTitle}
                placeholder="goal title (e.g. Master Kubernetes)"
                className="mb-3"
              />
              <textarea
                value={newGoalDesc}
                onChange={e => setNewGoalDesc(e.target.value)}
                placeholder="short description (optional)"
                className="w-full bg-term-bg border border-term-border p-3 text-term-primary placeholder:text-term-muted focus:outline-none focus:border-term-primary mb-3 text-sm min-h-[60px] font-term resize-none"
              />
              <TerminalButton solid onClick={createGoal} className="w-full text-center">
                create goal
              </TerminalButton>
            </TerminalWindow>

            {/* AI Generate */}
            <TerminalWindow title="AI_GENERATE_ROADMAP" variant="amber">
              <p className="text-xs text-term-muted mb-4">type a topic and your ai engine will generate a structured 5-step learning roadmap, then search the web for real resources for each step. takes under a minute.</p>
              <TerminalPromptInput
                value={generateTopic}
                onChange={setGenerateTopic}
                onKeyDown={e => e.key === 'Enter' && generatePath()}
                placeholder="e.g. eBPF for Observability, Prometheus, Helm"
                className="mb-3"
              />
              <TerminalButton solid variant="amber" onClick={generatePath} disabled={generating} className="w-full text-center">
                <span className="flex items-center justify-center gap-2">
                  {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> generating…</> : <><Sparkles className="w-4 h-4" /> generate with ai</>}
                </span>
              </TerminalButton>
            </TerminalWindow>
          </div>

          {/* Goals list */}
          {goals.length === 0 && (
            <div className="text-center text-term-muted py-16">
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>no goals yet. add one above or generate with ai!</p>
            </div>
          )}

          <div className="space-y-4">
            {goals.map(goal => {
              const isExpanded = expandedGoal === goal.id
              const doneSteps = goal.steps.filter(s => s.completed).length
              return (
                <TerminalWindow key={goal.id} noPadding>
                  {/* Header */}
                  <div
                    className="flex items-center gap-4 p-4 cursor-pointer hover:bg-term-muted/10 transition-colors"
                    onClick={() => setExpandedGoal(isExpanded ? null : goal.id)}
                  >
                    <div className="w-2 h-12 flex-shrink-0" style={{ background: goal.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-base text-term-primary">{goal.title}</h3>
                        {goal.status === 'completed' && (
                          <StatusTag variant="primary">
                            <span className="inline-flex items-center gap-1"><Trophy className="w-3 h-3" /> completed</span>
                          </StatusTag>
                        )}
                      </div>
                      {goal.description && <p className="text-term-muted text-xs mt-0.5 truncate">{goal.description}</p>}
                      {/* Progress bar */}
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex-1 bg-term-border/40 h-1.5">
                          <div
                            className="h-1.5 transition-all"
                            style={{ width: `${goal.progress}%`, background: goal.color }}
                          />
                        </div>
                        <span className="text-[10px] text-term-muted font-bold whitespace-nowrap">{goal.progress}% · {doneSteps}/{goal.steps.length} steps</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={e => { e.stopPropagation(); deleteGoal(goal.id) }} className="p-1.5 text-term-muted hover:text-term-error transition-colors cursor-pointer">
                        <Trash2 className="w-4 h-4" />
                      </button>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-term-muted" /> : <ChevronDown className="w-4 h-4 text-term-muted" />}
                    </div>
                  </div>

                  {/* Steps */}
                  {isExpanded && (
                    <div className="border-t border-dashed border-term-border p-4 space-y-1">
                      {goal.steps.length === 0 && <p className="text-term-muted text-sm italic">no steps yet. add one below.</p>}
                      {goal.steps.map((step, idx) => (
                        <div
                          key={step.id}
                          className="flex items-start gap-3 p-2.5 hover:bg-term-muted/10 transition-colors group"
                        >
                          <button
                            onClick={() => toggleStep(step.id, !step.completed)}
                            className="mt-0.5 flex-shrink-0 cursor-pointer"
                          >
                            {step.completed
                              ? <CheckCircle2 className="w-4 h-4 text-term-primary" />
                              : <Circle className="w-4 h-4 text-term-muted group-hover:text-term-primary/60" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className={`font-semibold text-sm ${step.completed ? 'line-through text-term-muted' : 'text-term-primary/90'}`}>
                              {idx + 1}. {step.title}
                            </p>
                            {step.description && <p className="text-xs text-term-muted mt-0.5">{step.description}</p>}

                            {step.resources && step.resources.length > 0 ? (
                              <div className="mt-2 space-y-1">
                                {step.resources.map((r, ri) => (
                                  <a
                                    key={ri}
                                    href={r.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1.5 text-xs text-term-amber hover:underline truncate"
                                  >
                                    <ExternalLink className="w-3 h-3 flex-shrink-0" /> {r.title}
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <button
                                onClick={() => findResources(goal.id, step.id)}
                                disabled={findingResourcesFor === step.id}
                                className="flex items-center gap-1.5 text-xs text-term-muted hover:text-term-amber disabled:opacity-50 mt-2 cursor-pointer"
                              >
                                <Search className={`w-3 h-3 ${findingResourcesFor === step.id ? 'animate-spin' : ''}`} />
                                {findingResourcesFor === step.id ? 'searching...' : 'find resources'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      {/* Add step */}
                      <div className="flex gap-2 mt-3 pt-3 border-t border-dashed border-term-border items-center">
                        <TerminalPromptInput
                          value={newStepTexts[goal.id] || ''}
                          onChange={v => setNewStepTexts(prev => ({ ...prev, [goal.id]: v }))}
                          onKeyDown={e => e.key === 'Enter' && addStep(goal.id)}
                          placeholder="add a step…"
                          className="flex-1"
                        />
                        <TerminalButton size="sm" onClick={() => addStep(goal.id)}>
                          <Plus className="w-3.5 h-3.5" />
                        </TerminalButton>
                      </div>
                    </div>
                  )}
                </TerminalWindow>
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
              { label: 'Hours This Month', value: `${totalHours}h`, icon: Clock },
              { label: 'Active Days', value: activeDays, icon: Calendar },
              { label: 'Total Sessions', value: timeLogs.length, icon: BarChart2 },
              { label: 'Goals Tracking', value: goals.length, icon: Target },
            ].map(s => (
              <div key={s.label} className="border border-term-border p-4 flex items-center gap-4">
                <div className="text-term-primary"><s.icon className="w-5 h-5" /></div>
                <div>
                  <div className="text-xl font-extrabold text-term-primary">{s.value}</div>
                  <div className="text-[10px] text-term-muted uppercase tracking-wide">{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Log time */}
          <TerminalWindow title="LOG_STUDY_SESSION">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="text-[10px] text-term-muted mb-1 block uppercase tracking-wide">Date</label>
                <input
                  type="date"
                  value={logDate}
                  onChange={e => setLogDate(e.target.value)}
                  className="w-full bg-term-bg border border-term-border p-2.5 text-term-primary focus:outline-none focus:border-term-primary text-sm font-term"
                />
              </div>
              <div>
                <label className="text-[10px] text-term-muted mb-1 block uppercase tracking-wide">Duration (minutes)</label>
                <input
                  type="number"
                  min="1"
                  value={logMinutes}
                  onChange={e => setLogMinutes(e.target.value)}
                  placeholder="e.g. 45"
                  className="w-full bg-term-bg border border-term-border p-2.5 text-term-primary placeholder:text-term-muted focus:outline-none focus:border-term-primary text-sm font-term"
                />
              </div>
              <div>
                <label className="text-[10px] text-term-muted mb-1 block uppercase tracking-wide">Goal (optional)</label>
                <select
                  value={logGoalId}
                  onChange={e => setLogGoalId(e.target.value)}
                  className="w-full bg-term-bg border border-term-border p-2.5 text-term-primary focus:outline-none focus:border-term-primary text-sm font-term cursor-pointer"
                >
                  <option value="">— Unlinked —</option>
                  {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-term-muted mb-1 block uppercase tracking-wide">Notes (optional)</label>
                <input
                  value={logNotes}
                  onChange={e => setLogNotes(e.target.value)}
                  placeholder="what did you study?"
                  className="w-full bg-term-bg border border-term-border p-2.5 text-term-primary placeholder:text-term-muted focus:outline-none focus:border-term-primary text-sm font-term"
                />
              </div>
            </div>
            <TerminalButton
              solid
              onClick={logTime}
              disabled={savingLog || !logMinutes}
              className="mt-4"
            >
              <span className="flex items-center gap-2">
                {savingLog ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                log session
              </span>
            </TerminalButton>
          </TerminalWindow>

          {/* Bar chart: daily hours */}
          <TerminalWindow title={`${monthName.toUpperCase()} — DAILY STUDY TIME`}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyChartData} barSize={18}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="day" tick={CHART_TICK} />
                <YAxis tick={CHART_TICK} unit="h" />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  labelStyle={{ color: '#a8f090' }}
                  itemStyle={{ color: '#33ff00' }}
                  formatter={(val: any) => [`${val}h`, 'Study Time']}
                  labelFormatter={(l: any) => `Day ${l}`}
                />
                <Bar dataKey="hours" radius={[0, 0, 0, 0]}>
                  {monthlyChartData.map((entry, index) => (
                    <Cell key={index} fill={entry.hours > 0 ? '#33ff00' : '#1f521f'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </TerminalWindow>

          {/* Goal breakdown */}
          {goalBreakdown.length > 0 && (
            <TerminalWindow title="HOURS_BY_GOAL_ALL_TIME" variant="amber">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={goalBreakdown} layout="vertical" barSize={16}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                  <XAxis type="number" tick={CHART_TICK} unit="h" />
                  <YAxis dataKey="name" type="category" width={160} tick={CHART_TICK} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    itemStyle={{ color: '#ffb000' }}
                    formatter={(val: any) => [`${val}h`, 'Hours']}
                  />
                  <Bar dataKey="hours" radius={[0, 0, 0, 0]}>
                    {goalBreakdown.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </TerminalWindow>
          )}

          {/* Recent sessions */}
          <TerminalWindow title="RECENT_SESSIONS">
            {timeLogs.length === 0 && (
              <p className="text-term-muted text-sm italic">no sessions logged yet.</p>
            )}
            <div className="space-y-2">
              {timeLogs.slice(0, 20).map(log => (
                <div key={log.id} className="flex items-center justify-between p-3 border border-term-border group">
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-term-primary flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-term-primary/90">{log.duration_minutes} min {log.goal_title ? `— ${log.goal_title}` : ''}</p>
                      {log.notes && <p className="text-xs text-term-muted">{log.notes}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-term-muted">{new Date(log.log_date).toLocaleDateString()}</span>
                    <button onClick={() => deleteLog(log.id)} className="opacity-0 group-hover:opacity-100 text-term-muted hover:text-term-error transition-all cursor-pointer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </TerminalWindow>
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
const FREQ_VARIANT: Record<string, 'primary' | 'amber' | 'error'> = { daily: 'primary', weekly: 'amber', monthly: 'error' }

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
          { label: 'Active Check-ins', value: checkIns.length, icon: Bell },
          { label: 'Done Today', value: `${doneToday}/${checkIns.length}`, icon: CheckCircle2 },
          { label: 'Total Streaks', value: totalStreaks, icon: Repeat },
          { label: 'Goals Linked', value: checkIns.filter(c => c.goalId).length, icon: Target },
        ].map(s => (
          <div key={s.label} className="border border-term-border p-4 flex items-center gap-3">
            <div className="text-term-primary"><s.icon className="w-5 h-5" /></div>
            <div>
              <div className="text-xl font-extrabold text-term-primary">{s.value}</div>
              <div className="text-[10px] text-term-muted uppercase tracking-wide">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Add new check-in */}
      <TerminalWindow title="SCHEDULE_A_CHECK-IN">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] text-term-muted mb-1 block uppercase tracking-wide">Title *</label>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="e.g. Review SRE metrics"
              className="w-full bg-term-bg border border-term-border p-2.5 text-sm text-term-primary placeholder:text-term-muted focus:outline-none focus:border-term-primary font-term" />
          </div>
          <div>
            <label className="text-[10px] text-term-muted mb-1 block uppercase tracking-wide">Description</label>
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
              placeholder="What to do during this check-in"
              className="w-full bg-term-bg border border-term-border p-2.5 text-sm text-term-primary placeholder:text-term-muted focus:outline-none focus:border-term-primary font-term" />
          </div>
          <div>
            <label className="text-[10px] text-term-muted mb-1 block uppercase tracking-wide">Frequency</label>
            <select value={newFreq} onChange={e => setNewFreq(e.target.value as any)}
              className="w-full bg-term-bg border border-term-border p-2.5 text-sm text-term-primary focus:outline-none focus:border-term-primary font-term cursor-pointer">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-term-muted mb-1 block uppercase tracking-wide">Time</label>
            <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)}
              className="w-full bg-term-bg border border-term-border p-2.5 text-sm text-term-primary focus:outline-none focus:border-term-primary font-term" />
          </div>
          <div>
            <label className="text-[10px] text-term-muted mb-1 block uppercase tracking-wide">Linked Goal (optional)</label>
            <select value={newGoalId} onChange={e => setNewGoalId(e.target.value)}
              className="w-full bg-term-bg border border-term-border p-2.5 text-sm text-term-primary focus:outline-none focus:border-term-primary font-term cursor-pointer">
              <option value="">— None —</option>
              {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>
          {newFreq === 'weekly' && (
            <div>
              <label className="text-[10px] text-term-muted mb-2 block uppercase tracking-wide">Days of Week</label>
              <div className="flex gap-1.5 flex-wrap">
                {DAY_LABELS.map((d, i) => (
                  <TerminalButton key={i} size="sm" solid={newDays.includes(i)} onClick={() => toggleDay(i)}>
                    {d.toLowerCase()}
                  </TerminalButton>
                ))}
              </div>
            </div>
          )}
        </div>
        <TerminalButton solid onClick={addCheckIn} className="mt-4">
          <span className="flex items-center gap-2">
            <AlarmClock className="w-4 h-4" /> schedule check-in
          </span>
        </TerminalButton>
      </TerminalWindow>

      {/* Check-ins list */}
      {checkIns.length === 0 && (
        <div className="text-center py-16 text-term-muted">
          <Bell className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>no check-ins scheduled. add one above!</p>
        </div>
      )}

      <div className="space-y-3">
        {checkIns.map(ci => {
          const done = isDoneToday(ci.id)
          const linkedGoal = goals.find(g => g.id === ci.goalId)
          return (
            <div key={ci.id} className={`border p-4 flex items-start justify-between gap-4 transition-all
              ${done ? 'border-term-primary/50 bg-term-primary/5' : 'border-term-border'}`}>
              <div className="flex items-start gap-4 flex-1 min-w-0">
                <button onClick={() => markDone(ci.id)}
                  className={`mt-0.5 flex-shrink-0 cursor-pointer transition-colors ${done ? 'text-term-primary' : 'text-term-muted hover:text-term-amber'}`}>
                  {done ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className={`font-bold text-sm ${done ? 'line-through text-term-muted' : 'text-term-primary'}`}>{ci.title}</h3>
                    <StatusTag variant={FREQ_VARIANT[ci.frequency]}>{ci.frequency}</StatusTag>
                    {done && <StatusTag variant="primary">done today</StatusTag>}
                  </div>
                  {ci.description && <p className="text-xs text-term-muted mb-2">{ci.description}</p>}
                  <div className="flex items-center gap-3 text-xs text-term-muted flex-wrap">
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
                      <span className="flex items-center gap-1 text-term-amber font-bold">streak: {ci.streak}</span>
                    )}
                  </div>
                </div>
              </div>
              <button onClick={() => deleteCheckIn(ci.id)}
                className="text-term-muted hover:text-term-error transition-colors cursor-pointer flex-shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
