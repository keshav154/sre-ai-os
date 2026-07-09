'use client'
import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/api'
import { Settings as SettingsIcon, Save, CheckCircle2, AlertCircle } from "lucide-react"
import { TerminalWindow, TerminalButton, Blinker } from '@/components/terminal'

export default function Settings() {
  const [keywords, setKeywords] = useState("SRE, DevOps")
  const [llmEngine, setLlmEngine] = useState("ollama")
  const [ollamaModel, setOllamaModel] = useState("llama3:latest")
  const [openrouterKey, setOpenrouterKey] = useState("")
  const [openaiKey, setOpenaiKey] = useState("")
  const [anthropicKey, setAnthropicKey] = useState("")
  const [geminiKey, setGeminiKey] = useState("")
  const [nvidiaNimKey, setNvidiaNimKey] = useState("")
  const [youtubeApiKey, setYoutubeApiKey] = useState("")
  const [webhookUrl, setWebhookUrl] = useState("")
  const [customFeeds, setCustomFeeds] = useState("https://devops.com/feed/,\nhttps://thenewstack.io/feed/,\nhttps://www.infoq.com/devops/news/rss/,\nhttps://aws.amazon.com/blogs/devops/feed/,\nhttps://netflixtechblog.com/feed,\nhttps://blog.cloudflare.com/rss/,\nhttps://kubernetes.io/feed.xml")
  const [obsidianVaultPath, setObsidianVaultPath] = useState("")
  const [githubRepo, setGithubRepo] = useState("")
  const [githubToken, setGithubToken] = useState("")

  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [testingDigest, setTestingDigest] = useState(false)
  const [digestResult, setDigestResult] = useState('')
  const [testingYoutube, setTestingYoutube] = useState(false)
  const [youtubeTestResult, setYoutubeTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  useEffect(() => {
    apiFetch(`${API}/settings`)
      .then(r => r.json())
      .then(d => {
        setKeywords(d.keywords || "SRE, DevOps")
        setLlmEngine(d.llm_engine || "ollama")
        setOllamaModel(d.ollama_model || "llama3:latest")
        setOpenrouterKey(d.openrouter_key || "")
        setOpenaiKey(d.openai_key || "")
        setAnthropicKey(d.anthropic_key || "")
        setGeminiKey(d.gemini_key || "")
        setNvidiaNimKey(d.nvidia_nim_key || "")
        setYoutubeApiKey(d.youtube_api_key || "")
        setWebhookUrl(d.webhook_url || "")
        setCustomFeeds(d.custom_feeds || "https://devops.com/feed/,\nhttps://thenewstack.io/feed/,\nhttps://www.infoq.com/devops/news/rss/,\nhttps://aws.amazon.com/blogs/devops/feed/,\nhttps://netflixtechblog.com/feed,\nhttps://blog.cloudflare.com/rss/,\nhttps://kubernetes.io/feed.xml")
        setObsidianVaultPath(d.obsidian_vault_path || "")
        setGithubRepo(d.github_repo || "")
        setGithubToken(d.github_token || "")
      })
      .catch(console.error)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus('idle')
    try {
      await apiFetch(`${API}/settings`, {
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
          nvidia_nim_key: nvidiaNimKey,
          youtube_api_key: youtubeApiKey,
          webhook_url: webhookUrl,
          custom_feeds: customFeeds,
          obsidian_vault_path: obsidianVaultPath,
          github_repo: githubRepo,
          github_token: githubToken
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

  const handleTestDigest = async () => {
    setTestingDigest(true)
    setDigestResult('')
    try {
      // Persist the webhook URL first so the backend has it before we trigger a run.
      await handleSave()
      const res = await apiFetch(`${API}/digest/run`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setDigestResult(`Failed: ${data.detail || 'unknown error'}`)
      } else if (data.status === 'no_new_items') {
        setDigestResult('No new items since the last digest — nothing sent.')
      } else {
        setDigestResult(`Sent! ${data.item_count} item(s) posted to your webhook.`)
      }
    } catch (e) {
      setDigestResult('Failed to reach backend.')
    }
    setTestingDigest(false)
  }

  const handleTestYoutubeKey = async () => {
    setTestingYoutube(true)
    setYoutubeTestResult(null)
    try {
      // Persist the key first so the backend has the current value to test.
      await handleSave()
      const res = await apiFetch(`${API}/settings/test-youtube-key`, { method: 'POST' })
      const data = await res.json()
      setYoutubeTestResult(data)
    } catch (e) {
      setYoutubeTestResult({ ok: false, message: 'Failed to reach backend.' })
    }
    setTestingYoutube(false)
  }

  const fieldClass = "w-full bg-term-bg border border-term-border p-3 text-term-primary placeholder:text-term-muted focus:outline-none focus:border-term-primary font-term text-sm"
  const labelClass = "block text-[10px] font-bold mb-1.5 text-term-muted uppercase tracking-wide"

  return (
    <div className="min-h-screen bg-term-bg text-term-primary p-6 font-term">
      <header className="mb-8">
        <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2 uppercase term-glow">
          <SettingsIcon className="w-6 h-6" /> ENGINE_SETTINGS<Blinker className="ml-0.5" />
        </h1>
        <p className="text-term-muted mt-1 text-xs">manage your discovery and ai engine preferences.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl">
        <TerminalWindow title="DISCOVERY_KEYWORDS">
          <p className={labelClass}>Keywords</p>
          <p className="text-xs text-term-muted mb-3">comma-separated list of topics to automatically hunt for on youtube and medium.</p>
          <textarea
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            className={`${fieldClass} min-h-[70px] mb-6 resize-none`}
          />

          <p className={labelClass}>Custom RSS Feeds</p>
          <p className="text-xs text-term-muted mb-3">comma-separated list of exact rss feed urls to parse.</p>
          <textarea
            value={customFeeds}
            onChange={(e) => setCustomFeeds(e.target.value)}
            className={`${fieldClass} min-h-[110px] mb-4`}
          />

          <p className={labelClass}>YouTube Data API Key (optional)</p>
          <p className="text-xs text-term-muted mb-3">
            without this, youtube results come from scraping search pages and dates are approximate.
            add a free <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-term-amber underline">youtube data api v3 key</a> for exact publish dates and more reliable "newest first" sorting.
          </p>
          <input
            type="password"
            value={youtubeApiKey}
            onChange={(e) => setYoutubeApiKey(e.target.value)}
            placeholder="AIzaSy..."
            className={`${fieldClass} mb-2`}
          />
          <TerminalButton
            size="sm"
            onClick={handleTestYoutubeKey}
            disabled={testingYoutube || !youtubeApiKey}
          >
            {testingYoutube ? 'testing...' : 'test connection'}
          </TerminalButton>
          {youtubeTestResult && (
            <p className={`text-xs mt-2 ${youtubeTestResult.ok ? 'text-term-primary' : 'text-term-error'}`}>
              [{youtubeTestResult.ok ? 'OK' : 'ERR'}] {youtubeTestResult.message}
            </p>
          )}
        </TerminalWindow>

        <TerminalWindow title="AI_MODEL_CONFIGURATION" variant="amber">
          <p className="text-xs text-term-muted mb-4">select which ai engine handles summarization.</p>

          <div className="mb-4">
            <label className={labelClass}>Primary Engine</label>
            <select
              value={llmEngine}
              onChange={(e) => setLlmEngine(e.target.value)}
              className={`${fieldClass} cursor-pointer`}
            >
              <option value="ollama">Ollama (Local)</option>
              <option value="openai">OpenAI (GPT-4o)</option>
              <option value="anthropic">Anthropic (Claude 3.5)</option>
              <option value="gemini">Google Gemini</option>
              <option value="openrouter">OpenRouter</option>
              <option value="nvidia_nim">NVIDIA NIM</option>
            </select>
          </div>

          <div className="mb-4">
            <label className={labelClass}>Model Name</label>
            <input
              type="text"
              value={ollamaModel}
              onChange={(e) => setOllamaModel(e.target.value)}
              className={`${fieldClass} mb-2`}
            />
            <p className="text-[10px] text-term-muted mb-3">examples: llama3:latest (ollama), meta-llama/llama-3-8b-instruct:free (openrouter), gpt-4o (openai), meta/llama-3.1-8b-instruct (nvidia nim)</p>

            {llmEngine === 'openai' && (
              <>
                <label className={labelClass}>OpenAI API Key</label>
                <input
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="sk-proj-..."
                  className={fieldClass}
                />
              </>
            )}

            {llmEngine === 'anthropic' && (
              <>
                <label className={labelClass}>Anthropic API Key</label>
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className={fieldClass}
                />
              </>
            )}

            {llmEngine === 'openrouter' && (
              <>
                <label className={labelClass}>OpenRouter API Key</label>
                <input
                  type="password"
                  value={openrouterKey}
                  onChange={(e) => setOpenrouterKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                  className={fieldClass}
                />
              </>
            )}

            {llmEngine === 'gemini' && (
              <>
                <label className={labelClass}>Google Gemini API Key</label>
                <input
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className={fieldClass}
                />
              </>
            )}

            {llmEngine === 'nvidia_nim' && (
              <>
                <label className={labelClass}>NVIDIA NIM API Key</label>
                <input
                  type="password"
                  value={nvidiaNimKey}
                  onChange={(e) => setNvidiaNimKey(e.target.value)}
                  placeholder="nvapi-..."
                  className={`${fieldClass} mb-2`}
                />
                <p className="text-[10px] text-term-muted">
                  get a free key at <a href="https://build.nvidia.com" target="_blank" rel="noreferrer" className="text-term-amber underline">build.nvidia.com</a>. browse available model names in their catalog — the model name field above must match exactly (e.g. <code className="bg-black border border-term-border px-1">meta/llama-3.1-8b-instruct</code>).
                </p>
              </>
            )}
          </div>
        </TerminalWindow>
      </div>

      {/* Obsidian Vault Section */}
      <div className="mt-6 max-w-5xl">
        <TerminalWindow title="OBSIDIAN_VAULT_INTEGRATION">
          <p className="text-xs text-term-muted mb-3">
            set the <strong className="text-term-primary">absolute path</strong> to your obsidian vault folder on this machine.
            articles saved via "save to vault" will be written as rich markdown notes inside a{" "}
            <code className="text-term-amber bg-black border border-term-border px-1">SRE-AI-OS/</code> subfolder in your vault.
          </p>
          <input
            type="text"
            value={obsidianVaultPath}
            onChange={e => setObsidianVaultPath(e.target.value)}
            placeholder={`e.g. C:\\Users\\YourName\\Documents\\ObsidianVault`}
            className={`${fieldClass} mb-2`}
          />
          <p className="text-[10px] text-term-muted">
            to find your vault path in obsidian: open settings → files &amp; links → vault location. copy the full path.
          </p>
        </TerminalWindow>
      </div>

      {/* GitHub Sync Section */}
      <div className="mt-6 max-w-5xl">
        <TerminalWindow title="CLOUD_SYNC_GITHUB_TO_OBSIDIAN">
          <p className="text-xs text-term-muted mb-4">
            if deploying to the cloud (like render.com), local vault paths won't work. instead, provide a github repository and token.
            articles saved via "save to vault" will be committed as markdown files to your repo. you can sync them locally using the <strong className="text-term-primary">obsidian git</strong> plugin!
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
            <div>
              <label className={labelClass}>GitHub Repository (e.g. username/repo)</label>
              <input
                type="text"
                value={githubRepo}
                onChange={e => setGithubRepo(e.target.value)}
                placeholder="username/my-obsidian-notes"
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass}>GitHub Personal Access Token</label>
              <input
                type="password"
                value={githubToken}
                onChange={e => setGithubToken(e.target.value)}
                placeholder="ghp_..."
                className={fieldClass}
              />
            </div>
          </div>
          <p className="text-[10px] text-term-muted">
            ensure your token has "repo" scope (classic token) or "contents" read/write (fine-grained token).
          </p>
        </TerminalWindow>
      </div>

      {/* Digest Webhook Section */}
      <div className="mt-6 max-w-5xl">
        <TerminalWindow title="DISCOVERY_DIGEST_SLACK_DISCORD" variant="amber">
          <p className="text-xs text-term-muted mb-4">
            paste a slack or discord incoming-webhook url to get a "what's new" digest posted automatically.
            pair this with a scheduled call to <code className="text-term-amber bg-black border border-term-border px-1">POST /digest/run</code> (e.g. a render cron job — see <code className="text-term-amber bg-black border border-term-border px-1">render.yaml</code>) to run it on a schedule.
          </p>
          <label className={labelClass}>Webhook URL</label>
          <input
            type="password"
            value={webhookUrl}
            onChange={e => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/... or https://discord.com/api/webhooks/..."
            className={`${fieldClass} mb-3`}
          />
          <TerminalButton solid variant="amber" size="sm" onClick={handleTestDigest} disabled={testingDigest || !webhookUrl}>
            {testingDigest ? 'sending...' : 'send digest now'}
          </TerminalButton>
          {digestResult && <p className="text-xs text-term-muted mt-2">{digestResult}</p>}
        </TerminalWindow>
      </div>

      <div className="mt-6 flex items-center gap-4">
        <TerminalButton solid onClick={handleSave} disabled={saving}>
          <span className="flex items-center gap-2">
            <Save className="w-4 h-4" /> {saving ? 'saving...' : 'save all settings'}
          </span>
        </TerminalButton>
        {saveStatus === 'success' && (
          <div className="flex items-center gap-2 text-term-primary font-bold text-sm">
            <CheckCircle2 className="w-4 h-4" /> saved successfully!
          </div>
        )}
        {saveStatus === 'error' && (
          <div className="flex items-center gap-2 text-term-error font-bold text-sm">
            <AlertCircle className="w-4 h-4" /> save failed — is the backend running?
          </div>
        )}
      </div>
    </div>
  )
}
