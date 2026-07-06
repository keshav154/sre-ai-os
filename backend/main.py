import time
import datetime
import requests
from fastapi import FastAPI, BackgroundTasks, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
from database import engine, Base, get_db
import models
from collector import ingest_url
from agents import research_agent, runbook_agent

# Create database tables
Base.metadata.create_all(bind=engine)

# create_all() only creates missing tables — it won't add new columns to an
# already-existing table (e.g. the production Supabase/Postgres DB on
# Render), so patch older DBs in place.
def _add_missing_columns(table: str, new_columns: dict):
    if engine.dialect.name == "sqlite":
        with engine.connect() as conn:
            existing_cols = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            for col, col_type in new_columns.items():
                if col not in existing_cols:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}"))
            conn.commit()
    else:
        # Postgres (Supabase) — IF NOT EXISTS makes this idempotent and safe
        # even if multiple Render instances boot concurrently and race on this DDL.
        with engine.connect() as conn:
            for col, col_type in new_columns.items():
                conn.execute(text(
                    f'ALTER TABLE public.{table} ADD COLUMN IF NOT EXISTS {col} {col_type}'
                ))
            conn.commit()

_add_missing_columns("settings", {
    "youtube_api_key": "VARCHAR",
    "webhook_url": "VARCHAR",
    "last_digest_at": "FLOAT",
    "nvidia_nim_key": "VARCHAR",
})
_add_missing_columns("articles", {
    "liked": "BOOLEAN DEFAULT FALSE",
    "notes": "TEXT",
    "embedding": "TEXT",
    "tags": "TEXT",
})

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
def get_articles(q: Optional[str] = None, limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    # `limit` is capped (not unbounded) to keep a single request from pulling
    # the whole table, but 100 replaces the old hardcoded 20.
    limit = max(1, min(limit, 500))
    query = db.query(models.Article)
    if q:
        like = f"%{q}%"
        query = query.filter(
            models.Article.title.ilike(like)
            | models.Article.summary.ilike(like)
            | models.Article.content.ilike(like)
        )
    return query.order_by(models.Article.created_at.desc()).offset(offset).limit(limit).all()

@app.post("/ingest")
def trigger_ingest(req: UrlRequest, db: Session = Depends(get_db)):
    result = ingest_url(req.url, db)
    return {"message": "Content successfully ingested and summarized.", "data": result}

@app.get("/discover")
def discover(force: bool = False, db: Session = Depends(get_db)):
    from collector import live_discover
    results = live_discover(db, force_refresh=force)
    return results

@app.post("/digest/run")
def run_digest(max_items: int = 15, db: Session = Depends(get_db)):
    """Posts a "what's new" digest to Settings.webhook_url (Slack/Discord
    incoming-webhook compatible). Intended to be hit by an external
    scheduler (e.g. a Render Cron Job) rather than called from the UI."""
    import datetime as _dt
    from collector import live_discover

    settings = db.query(models.Settings).first()
    webhook_url = settings.webhook_url if settings else None
    if not webhook_url:
        raise HTTPException(status_code=400, detail="No webhook_url configured in Settings.")

    results = live_discover(db)
    since = settings.last_digest_at or 0
    new_items = [r for r in results if r.get("timestamp", 0) > since][:max_items]

    if not new_items:
        settings.last_digest_at = time.time()
        db.commit()
        return {"status": "no_new_items", "sent": False}

    # Plain "title — url" pairs render correctly on both Slack ("text") and
    # Discord ("content") without relying on either platform's own markup
    # dialect, which aren't compatible with each other.
    lines = [f"SRE AI OS — {len(new_items)} new item(s) discovered:"]
    for item in new_items:
        lines.append(f"- {item['title']} (via {item.get('keyword', item['source'])})\n  {item['url']}")
    message = "\n".join(lines)

    try:
        resp = requests.post(webhook_url, json={"text": message, "content": message}, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to post to webhook: {e}")

    settings.last_digest_at = time.time()
    db.commit()
    return {"status": "sent", "sent": True, "item_count": len(new_items)}

class SettingsUpdate(BaseModel):
    keywords: str
    llm_engine: str
    ollama_model: str
    openrouter_key: Optional[str] = None
    openai_key: Optional[str] = None
    anthropic_key: Optional[str] = None
    gemini_key: Optional[str] = None
    nvidia_nim_key: Optional[str] = None
    youtube_api_key: Optional[str] = None
    webhook_url: Optional[str] = None
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
        "nvidia_nim_key": settings.nvidia_nim_key,
        "youtube_api_key": settings.youtube_api_key,
        "webhook_url": settings.webhook_url,
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
            nvidia_nim_key=req.nvidia_nim_key,
            youtube_api_key=req.youtube_api_key,
            webhook_url=req.webhook_url,
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
        settings.nvidia_nim_key = req.nvidia_nim_key
        if req.youtube_api_key is not None:
            settings.youtube_api_key = req.youtube_api_key
        if req.webhook_url is not None:
            settings.webhook_url = req.webhook_url
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
    from llm_client import llm, resolve_llm_config

    # Check if article already exists
    article = db.query(models.Article).filter(models.Article.url == req.url).first()

    if article:
        # If it already exists, generate a new summary for it
        settings = db.query(models.Settings).first()
        llm_engine, ollama_model, api_key = resolve_llm_config(settings)

        prompt = f"You are an SRE AI. Summarize the following content in detail, extracting the most important key learning points for an SRE/DevOps engineer. Here is the content:\n\n{article.content[:15000]}"
        summary = llm.generate(prompt, model_type=llm_engine, ollama_model=ollama_model, api_key=api_key)
        
        article.summary = summary
        db.commit()
        _embed_article(article, settings, db)
        _generate_tags(article, llm_engine, ollama_model, api_key, db)
        return {"title": article.title, "summary": summary, "status": "success"}
    else:
        # If it doesn't exist, ingest it and summarize
        res = ingest_url(req.url, db, summarize=True)
        if "error" in res and res.get("status") == "blocked":
            raise HTTPException(status_code=400, detail=res["error"])
        return res

def _write_note_to_vault(db: Session, article: "models.Article", section_title: str, body_text: str):
    """Shared by /save-to-vault and /like: builds the markdown note and
    writes it either to a local Obsidian vault or a GitHub repo, depending
    on Settings. Raises HTTPException on misconfiguration or write failure."""
    import datetime, os

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

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    safe_title = "".join(c for c in article.title if c.isalnum() or c in " -_").strip()

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

## {section_title}

{body_text}

---
*Saved by SRE AI OS*
"""
    try:
        if use_github:
            from github import Github
            g = Github(github_token)
            repo = g.get_repo(github_repo)
            file_path = f"SRE-AI-OS/{safe_title[:80]}.md"

            try:
                # Try to get file first to see if it exists (for update)
                contents = repo.get_contents(file_path)
                repo.update_file(contents.path, f"Update {safe_title}", note_content, contents.sha)
            except Exception:
                # If it doesn't exist, create it (404)
                repo.create_file(file_path, f"Add {safe_title}", note_content)
        else:
            # Create Knowledge folder inside vault locally
            knowledge_dir = os.path.join(vault_path, "SRE-AI-OS")
            os.makedirs(knowledge_dir, exist_ok=True)

            file_path = os.path.join(knowledge_dir, f"{safe_title[:80]}.md")
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(note_content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write to Obsidian vault: {str(e)}")

    return file_path

@app.post("/save-to-vault")
def save_to_vault(req: UrlRequest, db: Session = Depends(get_db)):
    from llm_client import resolve_llm_config
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

    summary_text = article.summary if article.summary and "Pending" not in article.summary else "Not yet summarized."
    file_path = _write_note_to_vault(db, article, "AI Summary & Key Learnings", summary_text)

    article.saved_to_obsidian = True
    db.commit()
    save_settings = db.query(models.Settings).first()
    if not article.embedding:
        _embed_article(article, save_settings, db)
    if not article.tags:
        llm_engine, ollama_model, api_key = resolve_llm_config(save_settings)
        _generate_tags(article, llm_engine, ollama_model, api_key, db)
    return {"message": f"Saved to Obsidian vault at {file_path}", "status": "saved", "path": file_path}

def _embed_article(article: "models.Article", db_settings, db: Session):
    """Computes and stores an embedding for an article so it's searchable
    via /ask. Best-effort: silently no-ops if no embedding provider
    (OpenAI key or local Ollama) is configured."""
    import json
    from llm_client import embed_texts

    text_for_embedding = " ".join(filter(None, [
        article.title,
        article.notes,
        article.summary if article.summary and "Pending" not in article.summary else None,
        (article.content or "")[:4000],
    ]))[:8000]

    vectors = embed_texts([text_for_embedding], db_settings)
    if vectors:
        article.embedding = json.dumps(vectors[0])
        db.commit()

def _generate_tags(article: "models.Article", llm_engine, ollama_model, api_key, db: Session):
    """Extracts 3-6 concept tags (e.g. "kubernetes", "rbac", "incident-response")
    via the LLM, used to build /api/graph from real extracted concepts
    instead of crude keyword-in-title substring matching. Best-effort."""
    import json, re as _re
    from llm_client import llm

    text = " ".join(filter(None, [article.title, article.notes, article.summary, (article.content or "")[:2000]]))[:6000]
    prompt = f"""Extract 3-6 short concept tags (lowercase, 1-3 words each, e.g. "kubernetes", "rbac", "incident response") that best describe the technical topics in the text below.
Return ONLY a JSON array of strings, no markdown: ["tag1", "tag2", ...]

Text:
{text}"""
    try:
        raw = llm.generate(prompt, model_type=llm_engine, ollama_model=ollama_model, api_key=api_key)
        match = _re.search(r'\[[\s\S]*\]', raw)
        if not match:
            return
        tags = [str(t).strip().lower() for t in json.loads(match.group()) if str(t).strip()]
        if tags:
            article.tags = json.dumps(tags[:6])
            db.commit()
    except Exception as e:
        import logging
        logging.getLogger("main").warning("Tag extraction failed for %r: %s", article.title, e)

def _generate_quiz_questions(article: "models.Article", llm_engine, ollama_model, api_key, db: Session):
    """Turns the AI notes on a liked item into 3-5 spaced-repetition recall
    questions, stored in `quiz_questions`. Best-effort — a malformed LLM
    response just means no quiz gets created for this item, which isn't
    fatal to the /like flow."""
    import json, re as _re
    from llm_client import llm

    prompt = f"""Based on these personal notes about "{article.title}", write 4 short active-recall quiz questions with concise answers, testing the key concepts (not trivia).
Return ONLY valid JSON, no markdown: [{{"question": "...", "answer": "..."}}, ...]

Notes:
{(article.notes or '')[:6000]}"""
    try:
        raw = llm.generate(prompt, model_type=llm_engine, ollama_model=ollama_model, api_key=api_key)
        match = _re.search(r'\[[\s\S]*\]', raw)
        if not match:
            return
        items = json.loads(match.group())
        for qa in items[:5]:
            if not qa.get("question") or not qa.get("answer"):
                continue
            db.add(models.QuizQuestion(
                article_id=article.id,
                article_title=article.title,
                question=qa["question"],
                answer=qa["answer"],
            ))
        db.commit()
    except Exception as e:
        import logging
        logging.getLogger("main").warning("Quiz generation failed for %r: %s", article.title, e)

@app.get("/quiz/due")
def get_due_quiz(limit: int = 10, db: Session = Depends(get_db)):
    limit = max(1, min(limit, 50))
    now = datetime.datetime.now(datetime.timezone.utc)
    due = (
        db.query(models.QuizQuestion)
        .filter(models.QuizQuestion.next_review_at <= now)
        .order_by(models.QuizQuestion.next_review_at.asc())
        .limit(limit)
        .all()
    )
    return due

@app.get("/quiz/stats")
def get_quiz_stats(db: Session = Depends(get_db)):
    now = datetime.datetime.now(datetime.timezone.utc)
    total = db.query(models.QuizQuestion).count()
    due = db.query(models.QuizQuestion).filter(models.QuizQuestion.next_review_at <= now).count()
    return {"total": total, "due": due}

class QuizAnswer(BaseModel):
    correct: bool

@app.post("/quiz/{question_id}/answer")
def answer_quiz(question_id: int, req: QuizAnswer, db: Session = Depends(get_db)):
    q = db.query(models.QuizQuestion).filter(models.QuizQuestion.id == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")

    # SM-2-lite: double the interval on a correct answer, reset to 1 day on a miss.
    q.interval_days = min(q.interval_days * 2, 180) if req.correct else 1
    q.review_count += 1
    q.next_review_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=q.interval_days)
    db.commit()
    return {"next_review_in_days": q.interval_days}

@app.post("/like")
def like_item(req: UrlRequest, db: Session = Depends(get_db)):
    """Marks a post/video as liked and generates richer, personal-note-style
    AI notes for it (key takeaways, quotes, action items) — distinct from
    the generic executive `summary` — then saves them to the vault if one
    is configured."""
    from llm_client import llm, resolve_llm_config

    article = db.query(models.Article).filter(models.Article.url == req.url).first()
    if not article:
        result = ingest_url(req.url, db, summarize=False)
        if "error" in result and result.get("status") == "blocked":
            raise HTTPException(status_code=400, detail=result["error"])
        article = db.query(models.Article).filter(models.Article.url == req.url).first()

    if not article:
        raise HTTPException(status_code=400, detail="Could not fetch content to like.")

    settings = db.query(models.Settings).first()
    llm_engine, ollama_model, api_key = resolve_llm_config(settings)

    prompt = f"""You are an SRE AI assistant taking personal notes on behalf of the user, who just liked this {article.source} item titled "{article.title}".
Write structured personal notes in Markdown with these sections:
## Key Takeaways
(3-6 bullet points of the most important ideas)
## Notable Quotes / Highlights
(direct quotes or standout moments, if any are identifiable)
## Action Items
(concrete things an SRE/DevOps engineer could try or investigate based on this)

Base your notes only on the following content:

{article.content[:15000]}"""
    notes = llm.generate(prompt, model_type=llm_engine, ollama_model=ollama_model, api_key=api_key)

    article.liked = True
    article.notes = notes
    db.commit()
    _embed_article(article, settings, db)
    _generate_tags(article, llm_engine, ollama_model, api_key, db)
    _generate_quiz_questions(article, llm_engine, ollama_model, api_key, db)

    saved_to_vault = False
    try:
        _write_note_to_vault(db, article, "AI Notes (Liked)", notes)
        article.saved_to_obsidian = True
        db.commit()
        saved_to_vault = True
    except HTTPException:
        # Vault not configured or unreachable — the notes are still saved in
        # the DB (visible in the app), just not persisted to a vault file.
        pass

    return {"title": article.title, "notes": notes, "liked": True, "saved_to_vault": saved_to_vault}

class AskRequest(BaseModel):
    question: str
    top_k: int = 5

def _search_vault(query: str, settings, db: Session, top_k: int = 5):
    """Shared semantic-search core for /ask and the grounded Research
    Agent: embeds `query`, scores it against every article's stored
    embedding via cosine similarity, and returns the top matches (empty
    list if no embedding provider is configured or nothing scores > 0)."""
    import json
    from llm_client import embed_texts, cosine_similarity

    articles = db.query(models.Article).filter(models.Article.embedding.isnot(None)).all()
    if not articles:
        return []

    query_vec = embed_texts([query], settings)
    if not query_vec:
        return []
    query_vec = query_vec[0]

    scored = []
    for a in articles:
        try:
            vec = json.loads(a.embedding)
        except (TypeError, ValueError):
            continue
        scored.append((cosine_similarity(query_vec, vec), a))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [a for score, a in scored[:max(1, min(top_k, 20))] if score > 0]

@app.post("/ask")
def ask_vault(req: AskRequest, db: Session = Depends(get_db)):
    """RAG over the saved vault: embeds the question, finds the most
    semantically similar saved articles/notes, and asks the configured LLM
    to answer using only that retrieved context, with citations."""
    from llm_client import llm, resolve_llm_config

    settings = db.query(models.Settings).first()
    if not db.query(models.Article).filter(models.Article.embedding.isnot(None)).first():
        raise HTTPException(status_code=400, detail="Your vault has no searchable notes yet. Like or summarize a few articles first (or run POST /vault/reindex to backfill existing ones).")

    top = _search_vault(req.question, settings, db, top_k=req.top_k)
    if not top:
        raise HTTPException(status_code=404, detail="No relevant notes found in your vault for that question (or no embedding provider is configured).")

    context_blocks = []
    for a in top:
        body = a.notes or a.summary or (a.content or "")[:2000]
        context_blocks.append(f"### {a.title}\nSource: {a.url}\n{body[:2000]}")
    context = "\n\n".join(context_blocks)

    prompt = f"""You are the user's personal SRE knowledge-base assistant. Answer the question below using ONLY the context notes provided — these are the user's own saved articles/videos. If the context doesn't contain the answer, say so plainly instead of guessing.

Cite which source(s) you used by title at the end of relevant sentences, like (Source: <title>).

# Context notes
{context}

# Question
{req.question}"""

    llm_engine, ollama_model, api_key = resolve_llm_config(settings)
    answer = llm.generate(prompt, model_type=llm_engine, ollama_model=ollama_model, api_key=api_key)

    return {
        "answer": answer,
        "sources": [{"title": a.title, "url": a.url} for a in top],
    }

@app.post("/vault/reindex")
def reindex_vault(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Backfills embeddings and concept tags for articles saved/liked before
    semantic search / the knowledge graph existed. Runs in the background
    since these are rate-limited LLM calls and this can take a while for a
    large vault."""
    from llm_client import resolve_llm_config

    def _reindex():
        session = next(get_db())
        try:
            settings = session.query(models.Settings).first()
            llm_engine, ollama_model, api_key = resolve_llm_config(settings)
            missing_embedding = session.query(models.Article).filter(models.Article.embedding.is_(None)).all()
            for article in missing_embedding:
                _embed_article(article, settings, session)
            missing_tags = session.query(models.Article).filter(models.Article.tags.is_(None)).all()
            for article in missing_tags:
                _generate_tags(article, llm_engine, ollama_model, api_key, session)
        finally:
            session.close()

    pending_embeddings = db.query(models.Article).filter(models.Article.embedding.is_(None)).count()
    pending_tags = db.query(models.Article).filter(models.Article.tags.is_(None)).count()
    background_tasks.add_task(_reindex)
    return {"message": f"Reindexing {pending_embeddings} embedding(s) and {pending_tags} tag set(s) in the background."}

@app.get("/cves")
def get_cves(limit: int = 50, db: Session = Depends(get_db)):
    limit = max(1, min(limit, 200))
    cves = db.query(models.CVE).order_by(models.CVE.created_at.desc()).limit(limit).all()
    return cves

@app.post("/cves/refresh")
def refresh_cves(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    from collector import fetch_and_store_cves
    settings = db.query(models.Settings).first()
    keywords = [k.strip() for k in (settings.keywords if settings else "SRE, DevOps").split(",") if k.strip()]
    # NVD is rate-limited (~5 req/30s) so this can take a while for several
    # keywords — run it in the background rather than blocking the request.
    background_tasks.add_task(fetch_and_store_cves, db, keywords)
    return {"message": f"CVE refresh started for {len(keywords)} keyword(s) in the background."}

@app.post("/agent/research")
def run_research_agent(req: PromptRequest, db: Session = Depends(get_db)):
    """Researches a topic, grounding the answer in the user's own saved
    vault notes when any are semantically relevant, then saves the result
    as a new vault article (so it's browsable in "My Saved Vault" and
    searchable via /ask, same as anything else saved)."""
    from llm_client import resolve_llm_config

    settings = db.query(models.Settings).first()
    llm_engine, ollama_model, api_key = resolve_llm_config(settings)

    relevant = _search_vault(req.prompt, settings, db, top_k=3)
    vault_context = "\n\n".join(
        f"### {a.title}\n{(a.notes or a.summary or '')[:1500]}" for a in relevant
    )

    response = research_agent.research(req.prompt, llm_engine, ollama_model, api_key, vault_context)

    article = models.Article(
        title=f"Research: {req.prompt}"[:200],
        author="Research Agent",
        source="Research Agent",
        url=f"research-agent://{time.time()}-{req.prompt[:80]}",
        content=response,
        summary=response,
        category="Research",
    )
    db.add(article)
    db.commit()
    _embed_article(article, settings, db)
    _generate_tags(article, llm_engine, ollama_model, api_key, db)

    saved_path = None
    try:
        saved_path = _write_note_to_vault(db, article, "AI Research", response)
        article.saved_to_obsidian = True
        db.commit()
    except HTTPException:
        pass

    return {
        "response": response,
        "grounded_on": [a.title for a in relevant],
        "saved_to_vault": bool(saved_path),
    }

@app.post("/agent/runbook")
def run_runbook_agent(req: PromptRequest, db: Session = Depends(get_db)):
    """Generates an incident runbook and saves it as a vault article."""
    from llm_client import resolve_llm_config

    settings = db.query(models.Settings).first()
    llm_engine, ollama_model, api_key = resolve_llm_config(settings)
    response = runbook_agent.generate_runbook(req.prompt, llm_engine, ollama_model, api_key)

    article = models.Article(
        title=f"Runbook: {req.prompt}"[:200],
        author="Runbook Agent",
        source="Runbook Agent",
        url=f"runbook-agent://{time.time()}-{req.prompt[:80]}",
        content=response,
        summary=response,
        category="Runbook",
    )
    db.add(article)
    db.commit()

    saved_path = None
    try:
        saved_path = _write_note_to_vault(db, article, "Runbook", response)
        article.saved_to_obsidian = True
        db.commit()
    except HTTPException:
        pass

    return {"response": response, "saved_to_vault": bool(saved_path)}

# ─── Knowledge Graph ──────────────────────────────────────────────────────────
@app.get("/api/graph")
def get_graph(db: Session = Depends(get_db)):
    import json

    settings = db.query(models.Settings).first()
    fallback_keywords = [k.strip() for k in (settings.keywords if settings else "SRE, DevOps").split(",") if k.strip()]
    articles = db.query(models.Article).order_by(models.Article.created_at.desc()).limit(100).all()

    nodes = []
    links = []
    seen_ids = set()
    seen_tag_ids = set()

    def ensure_tag_node(tag: str):
        nid = f"kw_{tag}"
        if nid not in seen_tag_ids:
            nodes.append({"id": nid, "label": tag, "type": "keyword", "val": 12})
            seen_tag_ids.add(nid)
        return nid

    for art in articles:
        nid = f"art_{art.id}"
        if nid not in seen_ids:
            nodes.append({"id": nid, "label": art.title[:50], "url": art.url, "source": art.source, "type": "article", "val": 6})
            seen_ids.add(nid)

        # Prefer real LLM-extracted concept tags (see _generate_tags) over
        # crude substring matching — they capture the article's actual
        # subject matter instead of just whether a configured keyword
        # happens to appear literally in the title/content.
        tags = []
        if art.tags:
            try:
                tags = json.loads(art.tags)
            except (TypeError, ValueError):
                tags = []

        if tags:
            for tag in tags:
                links.append({"source": ensure_tag_node(tag), "target": nid})
        else:
            # Fallback for articles that haven't been tagged yet (older
            # content, or no LLM configured) so the graph isn't empty for them.
            for kw in fallback_keywords:
                if kw.lower() in (art.title or "").lower() or kw.lower() in (art.content or "")[:500].lower():
                    links.append({"source": ensure_tag_node(kw), "target": nid})

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
    from llm_client import llm, resolve_llm_config
    import json, re as _re
    settings = db.query(models.Settings).first()
    llm_engine, ollama_model, api_key = resolve_llm_config(settings)

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

