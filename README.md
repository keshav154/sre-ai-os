# SRE AI OS 🧠

An AI-powered operating system for Site Reliability Engineers (SREs) and DevOps professionals. This local web application automatically curates, ingests, and summarizes the latest engineering blogs, articles, and YouTube videos, saving your insights directly into your local Obsidian Vault.

## ✨ Features
- **Live Tech Feed:** Aggregates RSS feeds (DevOps.com, TheNewStack, AWS, Cloudflare) and YouTube channels.
- **AI Summarization:** Uses Local LLMs (Ollama) or cloud models (OpenRouter, OpenAI, Anthropic, Gemini) to extract key SRE learnings.
- **Obsidian Integration:** One-click "Save to Vault" writes rich Markdown notes directly to your local file system.
- **Learning Paths & Goals:** Track your upskilling progress, daily streaks, and study schedule.
- **Time Tracking:** Monthly planner and focus timer to manage your deep work.
- **Privacy First:** Your database (`sre_ai_os.db`) stays entirely on your local machine.

## 🚀 Getting Started

### Prerequisites
1. **Python 3.10+** (for the backend)
2. **Node.js 18+** (for the frontend)
3. **Obsidian** (optional, but recommended for the vault integration)

### Installation & Running (Windows)
Simply run the startup script! It will automatically create virtual environments, install dependencies, and launch both the backend and frontend.

```powershell
.\start.bat
```

### Installation & Running (Mac/Linux)
```bash
chmod +x start.sh
./start.sh
```

## ⚙️ Configuration
Once the app opens in your browser at `http://localhost:3000`:
1. Navigate to the **Settings** tab.
2. Enter your desired **Discovery Keywords** (e.g., "Kubernetes, Terraform").
3. Select your preferred **AI Model** and enter an API key if using a cloud provider (or select Ollama for local offline use).
4. Enter the **absolute path** to your Obsidian Vault (e.g., `C:\Users\Name\Documents\MyVault`) to enable "Save to Vault".
5. Click **Save All Settings**.

## 🏗️ Tech Stack
- **Frontend:** Next.js (React), Tailwind CSS v4, Lucide Icons, React-Markdown.
- **Backend:** FastAPI (Python), SQLAlchemy (SQLite), BeautifulSoup4, YouTube Transcript API.
- **AI Integration:** OpenAI SDK wrapper (supports OpenAI, OpenRouter, Anthropic, Gemini, Ollama).

## 🛡️ License
MIT License. Feel free to clone, modify, and build upon this!
