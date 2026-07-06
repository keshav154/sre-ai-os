from fastapi import FastAPI, BackgroundTasks, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import engine, Base, get_db
import models
from collector import ingest_url
from agents import research_agent, runbook_agent

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="SRE AI OS API")

# Allow Next.js frontend to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class PromptRequest(BaseModel):
    prompt: str

class UrlRequest(BaseModel):
    url: str

@app.get("/")
def read_root():
    return {"message": "Welcome to SRE AI OS Backend"}

@app.get("/articles")
def get_articles(db: Session = Depends(get_db)):
    # Fetch the latest 20 learning items
    articles = db.query(models.Article).order_by(models.Article.created_at.desc()).limit(20).all()
    return articles

@app.post("/ingest")
def trigger_ingest(req: UrlRequest, db: Session = Depends(get_db)):
    result = ingest_url(req.url, db)
    return {"message": "Content successfully ingested and summarized.", "data": result}

@app.get("/discover")
def discover(db: Session = Depends(get_db)):
    from collector import live_discover
    results = live_discover(db)
    return results

class SettingsUpdate(BaseModel):
    keywords: str
    llm_engine: str
    ollama_model: str
    openrouter_key: Optional[str] = None
    openai_key: Optional[str] = None
    anthropic_key: Optional[str] = None
    gemini_key: Optional[str] = None
    custom_feeds: Optional[str] = None
    obsidian_vault_path: Optional[str] = None
    github_repo: Optional[str] = None
    github_token: Optional[str] = None

@app.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(models.Settings).first()
    if not settings:
        settings = models.Settings(
            keywords="SRE, DevOps", 
            llm_engine="ollama", 
            ollama_model="llama3:latest",
            custom_feeds="https://devops.com/feed/,\nhttps://thenewstack.io/feed/,\nhttps://www.infoq.com/devops/news/rss/,\nhttps://aws.amazon.com/blogs/devops/feed/,\nhttps://netflixtechblog.com/feed,\nhttps://blog.cloudflare.com/rss/,\nhttps://kubernetes.io/feed.xml"
        )
        db.add(settings)
        db.commit()
    return {
        "keywords": settings.keywords,
        "llm_engine": settings.llm_engine,
        "ollama_model": settings.ollama_model,
        "openrouter_key": settings.openrouter_key,
        "openai_key": settings.openai_key,
        "anthropic_key": settings.anthropic_key,
        "gemini_key": settings.gemini_key,
        "custom_feeds": settings.custom_feeds,
        "obsidian_vault_path": settings.obsidian_vault_path,
        "github_repo": settings.github_repo,
        "github_token": settings.github_token
    }

@app.post("/settings")
def update_settings(req: SettingsUpdate, db: Session = Depends(get_db)):
    settings = db.query(models.Settings).first()
    if not settings:
        settings = models.Settings(
            keywords=req.keywords, 
            llm_engine=req.llm_engine, 
            ollama_model=req.ollama_model,
            openrouter_key=req.openrouter_key,
            openai_key=req.openai_key,
            anthropic_key=req.anthropic_key,
            gemini_key=req.gemini_key,
            custom_feeds=req.custom_feeds
        )
        db.add(settings)
    else:
        settings.keywords = req.keywords
        settings.llm_engine = req.llm_engine
        settings.ollama_model = req.ollama_model
        settings.openrouter_key = req.openrouter_key
        settings.openai_key = req.openai_key
        settings.anthropic_key = req.anthropic_key
        settings.gemini_key = req.gemini_key
        if req.custom_feeds is not None:
            settings.custom_feeds = req.custom_feeds
        if req.obsidian_vault_path is not None:
            settings.obsidian_vault_path = req.obsidian_vault_path
        if req.github_repo is not None:
            settings.github_repo = req.github_repo
        if req.github_token is not None:
            settings.github_token = req.github_token
    db.commit()
    return {"message": "Settings updated"}

@app.post("/summarize")
def summarize_article(req: UrlRequest, db: Session = Depends(get_db)):
    from llm_client import llm
    
    # Check if article already exists
    article = db.query(models.Article).filter(models.Article.url == req.url).first()
    
    if article:
        # If it already exists, generate a new summary for it
        settings = db.query(models.Settings).first()
        llm_engine = settings.llm_engine if settings else "ollama"
        ollama_model = settings.ollama_model if settings else "llama3:latest"
        api_key = None
        if settings:
            if llm_engine == "openrouter": api_key = settings.openrouter_key
            elif llm_engine == "openai": api_key = settings.openai_key
            elif llm_engine == "anthropic": api_key = settings.anthropic_key
            elif llm_engine == "gemini": api_key = settings.gemini_key
            
        prompt = f"You are an SRE AI. Summarize the following content in detail, extracting the most important key learning points for an SRE/DevOps engineer. Here is the content:\n\n{article.content[:15000]}"
        summary = llm.generate(prompt, model_type=llm_engine, ollama_model=ollama_model, api_key=api_key)
        
        article.summary = summary
        db.commit()
        return {"title": article.title, "summary": summary, "status": "success"}
    else:
        # If it doesn't exist, ingest it and summarize
        res = ingest_url(req.url, db, summarize=True)
        if "error" in res and res.get("status") == "blocked":
            raise HTTPException(status_code=400, detail=res["error"])
        return res

@app.post("/save-to-vault")
def save_to_vault(req: UrlRequest, db: Session = Depends(get_db)):
    import datetime, os
    
    # Get vault path from DB settings
    settings = db.query(models.Settings).first()
    vault_path = settings.obsidian_vault_path if settings and settings.obsidian_vault_path else None
    github_repo = settings.github_repo if settings and settings.github_repo else None
    github_token = settings.github_token if settings and settings.github_token else None
    
    use_github = bool(github_repo and github_token)
    
    if not use_github:
        if not vault_path:
            raise HTTPException(status_code=400, detail="Obsidian vault path is not configured. Please set it or configure GitHub Sync in Settings.")
        if not os.path.isdir(vault_path):
            raise HTTPException(status_code=400, detail=f"Obsidian vault path does not exist: {vault_path}")

    # Ingest first if not already in DB
    article = db.query(models.Article).filter(models.Article.url == req.url).first()
    if not article:
        result = ingest_url(req.url, db, summarize=False)
        if "error" in result and result.get("status") == "blocked":
            raise HTTPException(status_code=400, detail=result["error"])
        article = db.query(models.Article).filter(models.Article.url == req.url).first()

    if not article:
        raise HTTPException(status_code=400, detail="Could not fetch article content.")
    
    if article.saved_to_obsidian:
        return {"message": "Already saved to vault.", "status": "already_saved"}

    # Write to Obsidian vault
    try:
        # Build rich markdown note
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        safe_title = "".join(c for c in article.title if c.isalnum() or c in " -_").strip()
        summary_text = article.summary if article.summary and "Pending" not in article.summary else "Not yet summarized."
        
        note_content = f"""---
title: "{article.title}"
source: {article.source}
url: {article.url}
date_saved: {now}
tags: [sre, ai-os]
---

# {article.title}

> **Source:** [{article.source}]({article.url})  
> **Saved:** {now}

## AI Summary & Key Learnings

{summary_text}

---
*Saved by SRE AI OS*
"""
        if use_github:
            from github import Github
            g = Github(github_token)
            repo = g.get_repo(github_repo)
            file_path = f"SRE-AI-OS/{safe_title[:80]}.md"
            
            try:
                # Try to get file first to see if it exists (for update)
                contents = repo.get_contents(file_path)
                repo.update_file(contents.path, f"Update {safe_title}", note_content, contents.sha)
            except Exception as e:
                # If it doesn't exist, create it (404)
                repo.create_file(file_path, f"Add {safe_title}", note_content)
                
        else:
            # Create Knowledge folder inside vault locally
            knowledge_dir = os.path.join(vault_path, "SRE-AI-OS")
            os.makedirs(knowledge_dir, exist_ok=True)
            
            file_path = os.path.join(knowledge_dir, f"{safe_title[:80]}.md")
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(note_content)
        
        article.saved_to_obsidian = True
        db.commit()
        return {"message": f"Saved to Obsidian vault at {file_path}", "status": "saved", "path": file_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write to Obsidian vault: {str(e)}")

@app.post("/collect")
def trigger_collection(background_tasks: BackgroundTasks):
    from collector import collect_mock_news
    background_tasks.add_task(collect_mock_news)
    return {"message": "Collection task started in the background."}

@app.post("/agent/research")
def run_research_agent(req: PromptRequest):
    return {"response": research_agent.process_and_save(req.prompt)}

@app.post("/agent/runbook")
def run_runbook_agent(req: PromptRequest):
    return {"response": runbook_agent.generate_runbook(req.prompt)}

# ─── Knowledge Graph ──────────────────────────────────────────────────────────
@app.get("/api/graph")
def get_graph(db: Session = Depends(get_db)):
    settings = db.query(models.Settings).first()
    keywords = [k.strip() for k in (settings.keywords if settings else "SRE, DevOps").split(",") if k.strip()]
    articles = db.query(models.Article).order_by(models.Article.created_at.desc()).limit(100).all()

    nodes = []
    links = []
    seen_ids = set()

    # Keyword nodes
    for kw in keywords:
        nid = f"kw_{kw}"
        nodes.append({"id": nid, "label": kw, "type": "keyword", "val": 12})
        seen_ids.add(nid)

    # Article nodes + edges to keyword
    for art in articles:
        nid = f"art_{art.id}"
        if nid not in seen_ids:
            nodes.append({"id": nid, "label": art.title[:50], "url": art.url, "source": art.source, "type": "article", "val": 6})
            seen_ids.add(nid)
        # Link to matching keywords
        for kw in keywords:
            if kw.lower() in (art.title or "").lower() or kw.lower() in (art.content or "")[:500].lower():
                links.append({"source": f"kw_{kw}", "target": nid})

    return {"nodes": nodes, "links": links}

# ─── Learning Goals ───────────────────────────────────────────────────────────
class GoalCreate(BaseModel):
    title: str
    description: Optional[str] = None
    color: Optional[str] = "#3b82f6"

class GoalUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    progress: Optional[int] = None
    status: Optional[str] = None
    color: Optional[str] = None

class StepCreate(BaseModel):
    goal_id: int
    title: str
    description: Optional[str] = None
    order_index: Optional[int] = 0

class StepToggle(BaseModel):
    completed: bool

class GenerateGoalRequest(BaseModel):
    topic: str

@app.get("/goals")
def get_goals(db: Session = Depends(get_db)):
    goals = db.query(models.LearningGoal).order_by(models.LearningGoal.created_at.desc()).all()
    result = []
    for g in goals:
        steps = db.query(models.LearningStep).filter(models.LearningStep.goal_id == g.id).order_by(models.LearningStep.order_index).all()
        result.append({
            "id": g.id, "title": g.title, "description": g.description,
            "progress": g.progress, "status": g.status, "color": g.color,
            "created_at": str(g.created_at),
            "steps": [{"id": s.id, "title": s.title, "description": s.description, "completed": s.completed, "order_index": s.order_index} for s in steps]
        })
    return result

@app.post("/goals")
def create_goal(req: GoalCreate, db: Session = Depends(get_db)):
    goal = models.LearningGoal(title=req.title, description=req.description, color=req.color or "#3b82f6")
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return {"id": goal.id, "title": goal.title, "progress": goal.progress, "status": goal.status, "color": goal.color, "description": goal.description, "steps": []}

# NOTE: /goals/ai-generate must come BEFORE /goals/{goal_id} to avoid FastAPI matching 'ai-generate' as an integer
@app.post("/goals/ai-generate")
def generate_goal_path(req: GenerateGoalRequest, db: Session = Depends(get_db)):
    from llm_client import llm
    import json, re as _re
    settings = db.query(models.Settings).first()
    llm_engine = settings.llm_engine if settings else "ollama"
    ollama_model = settings.ollama_model if settings else "llama3:latest"
    api_key = None
    if settings:
        if llm_engine == "openrouter": api_key = settings.openrouter_key
        elif llm_engine == "openai": api_key = settings.openai_key
        elif llm_engine == "anthropic": api_key = settings.anthropic_key
        elif llm_engine == "gemini": api_key = settings.gemini_key

    prompt = f"""You are an expert SRE career coach. Generate a structured learning roadmap for: "{req.topic}".
Return ONLY valid JSON, no markdown, no extra text:
{{"title": "Short goal title", "description": "2-sentence description", "steps": [{{"title": "Step title", "description": "What to do"}}]}}
Include exactly 5 steps."""

    try:
        raw = llm.generate(prompt, model_type=llm_engine, ollama_model=ollama_model, api_key=api_key)
        # Extract JSON robustly
        json_match = _re.search(r'\{[\s\S]*\}', raw)
        if not json_match:
            raise ValueError(f"No JSON in response: {raw[:200]}")
        data = json.loads(json_match.group())
        
        goal = models.LearningGoal(title=data["title"], description=data.get("description", ""), color="#8b5cf6")
        db.add(goal)
        db.commit()
        db.refresh(goal)
        
        saved_steps = []
        for i, step in enumerate(data.get("steps", [])[:5]):
            s = models.LearningStep(goal_id=goal.id, title=step["title"], description=step.get("description", ""), order_index=i)
            db.add(s)
            saved_steps.append({"id": 0, "title": step["title"], "description": step.get("description", ""), "completed": False, "order_index": i})
        db.commit()
        
        return {"id": goal.id, "title": goal.title, "description": goal.description, "progress": 0, "status": "active", "color": "#8b5cf6", "steps": saved_steps}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")

@app.put("/goals/{goal_id}")
def update_goal(goal_id: int, req: GoalUpdate, db: Session = Depends(get_db)):
    goal = db.query(models.LearningGoal).filter(models.LearningGoal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    if req.title is not None: goal.title = req.title
    if req.description is not None: goal.description = req.description
    if req.progress is not None: goal.progress = req.progress
    if req.status is not None: goal.status = req.status
    if req.color is not None: goal.color = req.color
    db.commit()
    return {"message": "Updated"}

@app.delete("/goals/{goal_id}")
def delete_goal(goal_id: int, db: Session = Depends(get_db)):
    db.query(models.LearningStep).filter(models.LearningStep.goal_id == goal_id).delete()
    db.query(models.LearningGoal).filter(models.LearningGoal.id == goal_id).delete()
    db.commit()
    return {"message": "Deleted"}

@app.post("/goals/{goal_id}/steps")
def add_step(goal_id: int, req: StepCreate, db: Session = Depends(get_db)):
    step = models.LearningStep(goal_id=goal_id, title=req.title, description=req.description, order_index=req.order_index)
    db.add(step)
    db.commit()
    db.refresh(step)
    return {"id": step.id, "title": step.title, "completed": step.completed}

@app.put("/steps/{step_id}")
def toggle_step(step_id: int, req: StepToggle, db: Session = Depends(get_db)):
    step = db.query(models.LearningStep).filter(models.LearningStep.id == step_id).first()
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    step.completed = req.completed
    # Recalculate goal progress
    all_steps = db.query(models.LearningStep).filter(models.LearningStep.goal_id == step.goal_id).all()
    if all_steps:
        done = sum(1 for s in all_steps if s.completed)
        goal = db.query(models.LearningGoal).filter(models.LearningGoal.id == step.goal_id).first()
        if goal:
            goal.progress = int((done / len(all_steps)) * 100)
            if goal.progress == 100:
                goal.status = "completed"
    db.commit()
    return {"message": "Updated"}



# ─── Time Tracking ────────────────────────────────────────────────────────────
class TimeLogCreate(BaseModel):
    goal_id: Optional[int] = None
    goal_title: Optional[str] = None
    duration_minutes: int
    notes: Optional[str] = None
    log_date: Optional[str] = None

@app.post("/time-logs")
def create_time_log(req: TimeLogCreate, db: Session = Depends(get_db)):
    import datetime
    log = models.TimeLog(
        goal_id=req.goal_id,
        goal_title=req.goal_title,
        duration_minutes=req.duration_minutes,
        notes=req.notes,
    )
    if req.log_date:
        try:
            log.log_date = datetime.datetime.fromisoformat(req.log_date)
        except:
            pass
    db.add(log)
    db.commit()
    db.refresh(log)
    return {"id": log.id, "message": "Time logged"}

@app.get("/time-logs")
def get_time_logs(db: Session = Depends(get_db)):
    logs = db.query(models.TimeLog).order_by(models.TimeLog.log_date.desc()).limit(200).all()
    return [{"id": l.id, "goal_id": l.goal_id, "goal_title": l.goal_title,
             "duration_minutes": l.duration_minutes, "notes": l.notes,
             "log_date": str(l.log_date)} for l in logs]

@app.delete("/time-logs/{log_id}")
def delete_time_log(log_id: int, db: Session = Depends(get_db)):
    db.query(models.TimeLog).filter(models.TimeLog.id == log_id).delete()
    db.commit()
    return {"message": "Deleted"}

