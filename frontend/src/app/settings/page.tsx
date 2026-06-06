'use client'
import { useState, useEffect } from 'react'
import { Terminal, Settings as SettingsIcon, Save, CheckCircle2, AlertCircle } from "lucide-react"

export default function Settings() {
  const [keywords, setKeywords] = useState("SRE, DevOps")
  const [llmEngine, setLlmEngine] = useState("ollama")
  const [ollamaModel, setOllamaModel] = useState("llama3:latest")
  const [openrouterKey, setOpenrouterKey] = useState("")
  const [openaiKey, setOpenaiKey] = useState("")
  const [anthropicKey, setAnthropicKey] = useState("")
  const [geminiKey, setGeminiKey] = useState("")
  const [customFeeds, setCustomFeeds] = useState("https://devops.com/feed/,\nhttps://thenewstack.io/feed/,\nhttps://www.infoq.com/devops/news/rss/,\nhttps://aws.amazon.com/blogs/devops/feed/,\nhttps://netflixtechblog.com/feed,\nhttps://blog.cloudflare.com/rss/,\nhttps://kubernetes.io/feed.xml")
  const [obsidianVaultPath, setObsidianVaultPath] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')

  useEffect(() => {
    fetch('http://localhost:8000/settings')
      .then(r => r.json())
      .then(d => {
        setKeywords(d.keywords || "SRE, DevOps")
        setLlmEngine(d.llm_engine || "ollama")
        setOllamaModel(d.ollama_model || "llama3:latest")
        setOpenrouterKey(d.openrouter_key || "")
        setOpenaiKey(d.openai_key || "")
        setAnthropicKey(d.anthropic_key || "")
        setGeminiKey(d.gemini_key || "")
        setCustomFeeds(d.custom_feeds || "https://devops.com/feed/,\nhttps://thenewstack.io/feed/,\nhttps://www.infoq.com/devops/news/rss/,\nhttps://aws.amazon.com/blogs/devops/feed/,\nhttps://netflixtechblog.com/feed,\nhttps://blog.cloudflare.com/rss/,\nhttps://kubernetes.io/feed.xml")
        setObsidianVaultPath(d.obsidian_vault_path || "")
      })
      .catch(console.error)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus('idle')
    try {
      await fetch('http://localhost:8000/settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ 
          keywords, 
          llm_engine: llmEngine, 
          ollama_model: ollamaModel,
          openrouter_key: openrouterKey,
          openai_key: openaiKey,
          anthropic_key: anthropicKey,
          gemini_key: geminiKey,
          custom_feeds: customFeeds,
          obsidian_vault_path: obsidianVaultPath
        })
      })
      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } catch(e) {
      console.error(e)
      setSaveStatus('error')
    }
    setSaving(false)
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 p-8 font-sans">
      <header className="mb-10">
        <h1 className="text-4xl font-extrabold tracking-tight flex items-center gap-3">
          <SettingsIcon className="w-8 h-8 text-emerald-400" /> Engine Settings
        </h1>
        <p className="text-zinc-400 mt-2 text-lg">Manage your discovery and AI engine preferences.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl">
        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl">
          <h2 className="text-xl font-bold mb-4">Discovery Keywords</h2>
          <p className="text-sm text-zinc-400 mb-4">Comma-separated list of topics to automatically hunt for on YouTube and Medium.</p>
          <textarea 
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 min-h-[80px] mb-8"
          />

          <h2 className="text-xl font-bold mb-4">Custom RSS Feeds</h2>
          <p className="text-sm text-zinc-400 mb-4">Comma-separated list of exact RSS Feed URLs to parse.</p>
          <textarea 
            value={customFeeds}
            onChange={(e) => setCustomFeeds(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 min-h-[120px] mb-4 font-mono text-sm"
          />
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl">
          <h2 className="text-xl font-bold mb-4">AI Model Configuration</h2>
          <p className="text-sm text-zinc-400 mb-4">Select which AI engine handles summarization.</p>
          
          <div className="mb-4">
            <label className="block text-sm font-semibold mb-2">Primary Engine</label>
            <select 
              value={llmEngine} 
              onChange={(e) => setLlmEngine(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="ollama">Ollama (Local)</option>
              <option value="openai">OpenAI (GPT-4o)</option>
              <option value="anthropic">Anthropic (Claude 3.5)</option>
              <option value="gemini">Google Gemini</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-semibold mb-2">Model Name</label>
            <input 
              type="text"
              value={ollamaModel}
              onChange={(e) => setOllamaModel(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-xs text-zinc-500 mt-2">Examples: llama3:latest (Ollama), meta-llama/llama-3-8b-instruct:free (OpenRouter), gpt-4o (OpenAI)</p>

            {llmEngine === 'openai' && (
              <>
                <label className="block text-sm font-semibold mb-2">OpenAI API Key</label>
                <input 
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="sk-proj-..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
              </>
            )}

            {llmEngine === 'anthropic' && (
              <>
                <label className="block text-sm font-semibold mb-2">Anthropic API Key</label>
                <input 
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
              </>
            )}

            {llmEngine === 'openrouter' && (
              <>
                <label className="block text-sm font-semibold mb-2">OpenRouter API Key</label>
                <input 
                  type="password"
                  value={openrouterKey}
                  onChange={(e) => setOpenrouterKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
              </>
            )}

            {llmEngine === 'gemini' && (
              <>
                <label className="block text-sm font-semibold mb-2">Google Gemini API Key</label>
                <input 
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
              </>
            )}
          </div>
        </section>
      </div>

      {/* Obsidian Vault Section */}
      <div className="mt-8 max-w-5xl">
        <section className="bg-zinc-900 border border-purple-900/40 rounded-xl p-6 shadow-xl">
          <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
            <span className="text-purple-400 text-2xl">📓</span> Obsidian Vault Integration
          </h2>
          <p className="text-sm text-zinc-400 mb-4">
            Set the <strong className="text-zinc-200">absolute path</strong> to your Obsidian vault folder on this machine.
            Articles saved via &quot;Save to Vault&quot; will be written as rich Markdown notes inside a{" "}
            <code className="text-purple-300 bg-zinc-800 px-1 rounded">SRE-AI-OS/</code> subfolder in your vault.
          </p>
          <input
            type="text"
            value={obsidianVaultPath}
            onChange={e => setObsidianVaultPath(e.target.value)}
            placeholder={`e.g. C:\\Users\\YourName\\Documents\\ObsidianVault`}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm mb-2"
          />
          <p className="text-xs text-zinc-500">
            To find your vault path in Obsidian: open Settings → Files &amp; Links → Vault location. Copy the full path.
          </p>
        </section>
      </div>

      <div className="mt-8 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-8 py-3 rounded-lg flex items-center gap-2 font-bold transition-colors cursor-pointer"
        >
          <Save className="w-5 h-5" /> {saving ? 'Saving...' : 'Save All Settings'}
        </button>
        {saveStatus === 'success' && (
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <CheckCircle2 className="w-4 h-4" /> Saved successfully!
          </div>
        )}
        {saveStatus === 'error' && (
          <div className="flex items-center gap-2 text-red-400 font-bold text-sm">
            <AlertCircle className="w-4 h-4" /> Save failed — is the backend running?
          </div>
        )}
      </div>
    </div>
  )
}
