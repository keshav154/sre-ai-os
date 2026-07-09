import time
import datetime
import difflib
import logging
import requests
from fastapi import FastAPI, BackgroundTasks, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
from config import settings as env_settings
from database import engine, Base, get_db
import models
import auth
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
    "related_articles": "TEXT",
})
_add_missing_columns("learning_steps", {
    "resources": "TEXT",
})

app = FastAPI(title="SRE AI OS API")

# ─── Auth gate ──────────────────────────────────────────────────────────────
# This app has no per-user data separation (see /auth/signup) — logging in
# just proves you're allowed in the door, everyone who's signed up shares
# the same vault/goals/settings. So the only job of this middleware is to
# make sure *someone unauthenticated* can't reach any of it, which was the
# actual problem being fixed here.
_PUBLIC_PATHS = {"/", "/auth/signup", "/auth/login", "/docs", "/openapi.json", "/redoc", "/docs/oauth2-redirect"}
_CRON_PATHS = {"/digest/run", "/agent/reflect"}

class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path in _PUBLIC_PATHS or request.method == "OPTIONS":
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer ") and auth.decode_access_token(auth_header[7:]) is not None:
            return await call_next(request)

        # Render Cron Jobs hit /digest/run and /agent/reflect without a user
        # session — let those in with a separate shared secret instead of
        # leaving them wide open to anyone.
        if path in _CRON_PATHS and request.headers.get("X-Cron-Secret") == env_settings.cron_secret:
            return await call_next(request)

        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})

# Added in reverse-execution order: Starlette wraps the LAST-added
# middleware outermost, so CORS (added last, here) always gets a chance to
# attach headers even when AuthMiddleware rejects a request — otherwise a
# 401 would come back with no CORS headers and the browser would just show
# an opaque network error instead of a readable 401.
app.add_middleware(AuthMiddleware)
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
    # Optional hints from the discover feed (RSS title/summary) used as a
    # last-resort fallback if the full page fetch gets bot-blocked — the
    # frontend already has these in memory for feed items, so passing them
    # along costs nothing and means a block doesn't have to be a dead end.
    fallback_title: Optional[str] = None
    fallback_content: Optional[str] = None

@app.get("/")
def read_root():
    return {"message": "Welcome to SRE AI OS Backend"}

class SignupRequest(BaseModel):
    email: str
    password: str
    invite_code: str = ""

class LoginRequest(BaseModel):
    email: str
    password: str

@app.post("/auth/signup")
def signup(req: SignupRequest, db: Session = Depends(get_db)):
    import hmac
    # Gated by a shared invite code (SIGNUP_SECRET) rather than left open —
    # anyone who finds the app's URL could otherwise create an account and
    # see everything, since this app has no per-user data separation.
    if not hmac.compare_digest(req.invite_code.strip(), env_settings.signup_secret):
        raise HTTPException(status_code=403, detail="Invalid invite code.")

    email = req.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Please provide a valid email.")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    if db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(status_code=400, detail="An account with that email already exists.")

    password_hash, salt = auth.hash_password(req.password)
    user = models.User(email=email, password_hash=password_hash, password_salt=salt)
    db.add(user)
    db.commit()
    db.refresh(user)

    token = auth.create_access_token(user.id)
    return {"token": token, "email": user.email}

@app.post("/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    email = req.email.strip().lower()
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user or not auth.verify_password(req.password, user.password_hash, user.password_salt):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    token = auth.create_access_token(user.id)
    return {"token": token, "email": user.email}

@app.get("/auth/me")
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return {"email": current_user.email}

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
            | models.Article.tags.ilike(like)
        )
    return query.order_by(models.Article.created_at.desc()).offset(offset).limit(limit).all()

@app.post("/ingest")
def trigger_ingest(req: UrlRequest, db: Session = Depends(get_db)):
    result = ingest_url(req.url, db, fallback_title=req.fallback_title, fallback_content=req.fallback_content)
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
        # These are Optional fields — a request that omits one (or any
        # future caller that only wants to update a subset of settings)
        # must not silently wipe out an already-configured key. Only
        # overwrite when the caller actually sent a value.
        if req.openrouter_key is not None:
            settings.openrouter_key = req.openrouter_key
        if req.openai_key is not None:
            settings.openai_key = req.openai_key
        if req.anthropic_key is not None:
            settings.anthropic_key = req.anthropic_key
        if req.gemini_key is not None:
            settings.gemini_key = req.gemini_key
        if req.nvidia_nim_key is not None:
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
            settings.github_repo = _normalize_github_repo(req.github_repo) if req.github_repo else req.github_repo
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
        res = ingest_url(req.url, db, summarize=True, fallback_title=req.fallback_title, fallback_content=req.fallback_content)
        if "error" in res and res.get("status") == "blocked":
            raise HTTPException(status_code=400, detail=res["error"])
        return res

def _safe_folder_name(name: str) -> str:
    cleaned = "".join(c for c in name if c.isalnum() or c in " -_").strip()
    return cleaned[:60] or "Uncategorized"

def _normalize_github_repo(raw: str) -> str:
    """GitHub's API wants exactly "owner/repo", but the most natural way to
    get a repo's identity is to copy it from GitHub's own UI — which hands
    you a full clone URL (https://github.com/owner/repo.git or
    git@github.com:owner/repo.git). Rather than making users hand-edit that
    down to the bare "owner/repo" form, strip the parts the API doesn't
    want."""
    import re
    s = raw.strip()
    s = re.sub(r'^(https?://)?(www\.)?github\.com[:/]', '', s, flags=re.IGNORECASE)
    s = re.sub(r'^git@github\.com:', '', s, flags=re.IGNORECASE)
    s = s.removesuffix('.git')
    return s.strip('/')

def _concept_folder(article: "models.Article") -> str:
    """The vault used to dump every note flat into one SRE-AI-OS/ folder.
    Now it files each note under SRE-AI-OS/{primary concept}/, using the
    first of the LLM-extracted tags (see _generate_tags) as the concept —
    so the vault ends up organized the same way the knowledge graph
    already groups things, instead of you having to sort N flat files
    yourself. Falls back to "Uncategorized" if tags haven't been
    generated yet (e.g. no embedding/LLM provider configured)."""
    import json
    try:
        tags = json.loads(article.tags) if article.tags else []
    except (TypeError, ValueError):
        tags = []
    return _safe_folder_name(tags[0]) if tags else "Uncategorized"

def _write_note_to_vault(db: Session, article: "models.Article", section_title: str, body_text: str, filename_override: str = None):
    """Shared by /save-to-vault, /like, the research/runbook agents, and
    /articles/{id}/consolidate: builds the markdown note and writes it
    either to a local Obsidian vault or a GitHub repo, depending on
    Settings. Raises HTTPException on misconfiguration or write failure."""
    import datetime, os, json

    settings = db.query(models.Settings).first()
    vault_path = settings.obsidian_vault_path if settings and settings.obsidian_vault_path else None
    github_repo = _normalize_github_repo(settings.github_repo) if settings and settings.github_repo else None
    github_token = settings.github_token if settings and settings.github_token else None

    use_github = bool(github_repo and github_token)

    if not use_github:
        if not vault_path:
            raise HTTPException(status_code=400, detail="Obsidian vault path is not configured. Please set it or configure GitHub Sync in Settings.")
        if not os.path.isdir(vault_path):
            raise HTTPException(status_code=400, detail=f"Obsidian vault path does not exist: {vault_path}")

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    safe_title = _safe_folder_name(filename_override or article.title)
    concept = _concept_folder(article)
    try:
        tags = json.loads(article.tags) if article.tags else []
    except (TypeError, ValueError):
        tags = []
    frontmatter_tags = ", ".join(["sre", "ai-os"] + tags) or "sre, ai-os"

    note_content = f"""---
title: "{article.title}"
source: {article.source}
url: {article.url}
date_saved: {now}
tags: [{frontmatter_tags}]
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
            from github import Github, GithubException

            def _github_message(exc: "GithubException") -> str:
                data = exc.data if isinstance(exc.data, dict) else {}
                return data.get("message") or str(exc)

            g = Github(github_token)
            try:
                repo = g.get_repo(github_repo)
            except GithubException as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not access GitHub repo '{github_repo}' ({e.status}: {_github_message(e)}). "
                           f"Check the repo name is exactly \"username/repo\" and your token has access to it.",
                )

            file_path = f"SRE-AI-OS/{concept}/{safe_title[:80]}.md"

            try:
                # Try to get the file first — if it exists, update it instead
                # of creating a duplicate/erroring.
                contents = repo.get_contents(file_path)
                repo.update_file(contents.path, f"Update {safe_title}", note_content, contents.sha)
            except GithubException as e:
                if e.status == 404:
                    # File genuinely doesn't exist yet (or the repo has no
                    # commits at all) — create it. Any other status here is a
                    # real problem (bad credentials, no write access, etc.)
                    # and should surface as an error rather than being
                    # silently retried as a create, which previously masked
                    # the actual cause behind a second, unrelated failure.
                    try:
                        repo.create_file(file_path, f"Add {safe_title}", note_content)
                    except GithubException as create_err:
                        raise HTTPException(
                            status_code=400,
                            detail=f"GitHub write failed ({create_err.status}: {_github_message(create_err)}). "
                                   f"Check your token has \"repo\" (or \"contents: write\") permission.",
                        )
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"GitHub write failed ({e.status}: {_github_message(e)}). "
                               f"Check your token has \"repo\" (or \"contents: write\") permission.",
                    )
        else:
            # Create Knowledge/{concept} folder inside vault locally
            knowledge_dir = os.path.join(vault_path, "SRE-AI-OS", concept)
            os.makedirs(knowledge_dir, exist_ok=True)

            file_path = os.path.join(knowledge_dir, f"{safe_title[:80]}.md")
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(note_content)
    except HTTPException:
        raise
    except Exception as e:
        target = "GitHub repo" if use_github else "Obsidian vault"
        raise HTTPException(status_code=500, detail=f"Failed to write to {target}: {str(e)}")

    return file_path

@app.post("/save-to-vault")
def save_to_vault(req: UrlRequest, db: Session = Depends(get_db)):
    from llm_client import resolve_llm_config
    # Ingest first if not already in DB
    article = db.query(models.Article).filter(models.Article.url == req.url).first()
    if not article:
        result = ingest_url(req.url, db, summarize=False, fallback_title=req.fallback_title, fallback_content=req.fallback_content)
        if "error" in result and result.get("status") == "blocked":
            raise HTTPException(status_code=400, detail=result["error"])
        article = db.query(models.Article).filter(models.Article.url == req.url).first()

    if not article:
        raise HTTPException(status_code=400, detail="Could not fetch article content.")

    if article.saved_to_obsidian:
        return {"message": "Already saved to vault.", "status": "already_saved"}

    # Tags decide which SRE-AI-OS/{concept}/ folder the note lands in, so
    # generate them before writing rather than after.
    save_settings = db.query(models.Settings).first()
    if not article.embedding:
        _embed_article(article, save_settings, db)
    if not article.tags:
        llm_engine, ollama_model, api_key = resolve_llm_config(save_settings)
        _generate_tags(article, llm_engine, ollama_model, api_key, db)

    summary_text = article.summary if article.summary and "Pending" not in article.summary else "Not yet summarized."
    file_path = _write_note_to_vault(db, article, "AI Summary & Key Learnings", summary_text)

    article.saved_to_obsidian = True
    db.commit()
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
        _link_related_articles(article, db)

def _link_related_articles(article: "models.Article", db: Session, top_k: int = 3):
    """Auto-links this article to the most similar other articles already
    in the vault, using the embeddings we already computed — no extra LLM
    call needed, just cosine similarity over vectors we have anyway. This
    is the kind of connection a second brain is supposed to make for you
    instead of you having to remember "didn't I save something like this
    before?" yourself."""
    import json
    from llm_client import cosine_similarity

    try:
        my_vec = json.loads(article.embedding)
    except (TypeError, ValueError):
        return

    others = (
        db.query(models.Article)
        .filter(models.Article.id != article.id, models.Article.embedding.isnot(None))
        .all()
    )
    scored = []
    for other in others:
        try:
            vec = json.loads(other.embedding)
        except (TypeError, ValueError):
            continue
        scored.append((cosine_similarity(my_vec, vec), other))
    scored.sort(key=lambda x: x[0], reverse=True)

    # 0.75 is a fairly high bar — this is meant to surface genuinely related
    # reading, not every article that's loosely in the same technical area.
    related = [a for score, a in scored[:top_k] if score >= 0.75]
    article.related_articles = json.dumps([{"id": a.id, "title": a.title, "url": a.url} for a in related])
    db.commit()

@app.get("/articles/{article_id}/concept-note")
def get_concept_note(article_id: int, db: Session = Depends(get_db)):
    """Returns the existing synthesized concept note for this article's
    primary concept, if one has been generated via /consolidate. Lets the
    frontend show "already consolidated" without re-running the LLM pass."""
    import json
    article = db.query(models.Article).filter(models.Article.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    concept = _concept_folder(article)
    note = db.query(models.ConceptNote).filter(models.ConceptNote.concept == concept).first()
    if not note:
        return None
    return {
        "concept": note.concept,
        "content": note.content,
        "source_article_ids": json.loads(note.source_article_ids) if note.source_article_ids else [],
        "updated_at": str(note.updated_at),
    }

@app.post("/articles/{article_id}/consolidate")
def consolidate_article(article_id: int, db: Session = Depends(get_db)):
    """Agentic note evolution: instead of leaving N separate per-article
    notes on the same idea, synthesizes this article and its auto-linked
    related articles (the same "🔗 Related" list surfaced in the UI) into
    one updated concept note, written to the vault as
    SRE-AI-OS/{concept}/_Concept - {concept}.md — a living document that
    gets updated (not duplicated) each time you consolidate again."""
    import json as _json
    from llm_client import llm, resolve_llm_config

    article = db.query(models.Article).filter(models.Article.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")

    try:
        related_refs = _json.loads(article.related_articles) if article.related_articles else []
    except (TypeError, ValueError):
        related_refs = []
    related_ids = [r["id"] for r in related_refs if "id" in r]
    related = db.query(models.Article).filter(models.Article.id.in_(related_ids)).all() if related_ids else []

    if not related:
        raise HTTPException(status_code=400, detail="No related articles yet to consolidate with — this article hasn't been auto-linked to anything similar.")

    sources = [article] + related
    concept = _concept_folder(article)

    source_blocks = []
    for a in sources:
        body = a.notes or a.summary or (a.content or "")[:1500]
        source_blocks.append(f"### {a.title}\n{body[:3000]}")
    combined = "\n\n".join(source_blocks)

    settings = db.query(models.Settings).first()
    llm_engine, ollama_model, api_key = resolve_llm_config(settings)

    prompt = f"""You are synthesizing {len(sources)} separate notes on the same underlying concept ("{concept}") into ONE unified, evolving concept note. This will replace scattered per-article notes with a single reference document.

Write structured Markdown with these sections:
## Overview
(2-3 sentences on what this concept covers, synthesized across all sources)
## Key Concepts
(merged, deduplicated bullet points — if two sources say the same thing, state it once; if they add different angles, capture both)
## Action Items
(a merged, deduplicated list of concrete things to try/investigate)
## Where This Came From
(one line per source noting what it specifically contributed, so nothing is lost in the merge)

If sources genuinely conflict or disagree, note that explicitly rather than silently picking one.

Source notes:
{combined}"""

    content = llm.generate(prompt, model_type=llm_engine, ollama_model=ollama_model, api_key=api_key)

    note = db.query(models.ConceptNote).filter(models.ConceptNote.concept == concept).first()
    if note:
        note.content = content
        note.source_article_ids = _json.dumps([a.id for a in sources])
    else:
        note = models.ConceptNote(concept=concept, content=content, source_article_ids=_json.dumps([a.id for a in sources]))
        db.add(note)
    db.commit()
    db.refresh(note)

    saved_path = None
    try:
        import types
        concept_note_shim = types.SimpleNamespace(
            title=f"Concept: {concept}",
            source="Concept Synthesis",
            url=f"concept://{concept}",
            tags=_json.dumps([concept]),
        )
        saved_path = _write_note_to_vault(
            db, concept_note_shim, "Synthesized Concept Note", content,
            filename_override=f"_Concept - {concept}",
        )
    except HTTPException:
        pass  # vault not configured — the concept note is still saved in the DB

    return {
        "concept": concept,
        "content": content,
        "source_titles": [a.title for a in sources],
        "saved_to_vault": bool(saved_path),
    }

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
        result = ingest_url(req.url, db, summarize=False, fallback_title=req.fallback_title, fallback_content=req.fallback_content)
        if "error" in result and result.get("status") == "blocked":
            raise HTTPException(status_code=400, detail=result["error"])
        article = db.query(models.Article).filter(models.Article.url == req.url).first()

    if not article:
        raise HTTPException(status_code=400, detail="Could not fetch content to like.")

    settings = db.query(models.Settings).first()
    llm_engine, ollama_model, api_key = resolve_llm_config(settings)
    memory_context = _get_memory_context(db)

    prompt = f"""You are an SRE AI assistant taking personal notes on behalf of the user, who just liked this {article.source} item titled "{article.title}".
Write structured personal notes in Markdown with these sections:
## Key Takeaways
(3-6 bullet points of the most important ideas)
## Notable Quotes / Highlights
(direct quotes or standout moments, if any are identifiable)
## Action Items
(concrete things an SRE/DevOps engineer could try or investigate based on this{', tailored to what you know about the user below' if memory_context else ''})
{f"{chr(10)}What you already know about this user, from past activity:{chr(10)}{memory_context}{chr(10)}" if memory_context else ""}
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

_MAX_STORED_MEMORIES = 20

def _get_memory_context(db: Session, limit: int = 10) -> str:
    """Formats accumulated agent memory as a context block for prompts.
    Marks the returned rows as just-used (last_used_at) so /memory can
    surface which observations are actually influencing agent output vs.
    which have gone stale — a form of the "transparency" half of the
    human-oversight pattern (you can always see and delete what the agent
    thinks it knows about you)."""
    memories = db.query(models.AgentMemory).order_by(models.AgentMemory.created_at.desc()).limit(limit).all()
    if not memories:
        return ""
    now = datetime.datetime.now(datetime.timezone.utc)
    for m in memories:
        m.last_used_at = now
    db.commit()
    return "\n".join(f"- [{m.category}] {m.content}" for m in memories)

def _synthesize_memory(db: Session, llm_engine, ollama_model, api_key, db_settings=None) -> list:
    """Called by the reflect loop: looks at accumulated activity (liked
    articles/tags, quiz performance, goal progress) and distills it into a
    small number of durable observations about the user — the kind of
    thing a colleague who'd worked with you a while would just *know*,
    rather than something that needs re-deriving every conversation."""
    import json, re as _re
    from llm_client import llm

    liked = db.query(models.Article).filter(models.Article.liked.is_(True)).order_by(models.Article.created_at.desc()).limit(30).all()
    if not liked:
        return []

    tag_counts: dict = {}
    for a in liked:
        try:
            for t in (json.loads(a.tags) if a.tags else []):
                tag_counts[t] = tag_counts.get(t, 0) + 1
        except (TypeError, ValueError):
            continue
    top_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:15]

    total_quiz = db.query(models.QuizQuestion).count()
    reviewed_quiz = db.query(models.QuizQuestion).filter(models.QuizQuestion.review_count > 0).count()
    active_goals = db.query(models.LearningGoal).filter(models.LearningGoal.status == "active").count()
    completed_goals = db.query(models.LearningGoal).filter(models.LearningGoal.status == "completed").count()

    existing = [m.content for m in db.query(models.AgentMemory).all()]

    prompt = f"""Based on this user's activity, write up to 3 short, durable observations (facts or patterns) about them that would be genuinely useful context for an AI assistant helping them in future — the kind of thing worth remembering long-term, not a summary of today.

Most-tagged topics across {len(liked)} liked items: {', '.join(f'{t} ({c})' for t, c in top_tags) or 'none yet'}
Recall quiz engagement: {reviewed_quiz}/{total_quiz} questions ever reviewed
Learning goals: {active_goals} active, {completed_goals} completed

Observations already on file (don't repeat these, only add genuinely new ones — return [] if nothing new stands out):
{chr(10).join(f'- {e}' for e in existing) or '(none yet)'}

Return ONLY valid JSON: [{{"category": "preference"|"pattern"|"fact", "content": "one sentence"}}] or []"""

    try:
        raw = llm.generate(prompt, model_type=llm_engine, ollama_model=ollama_model, api_key=api_key)
        match = _re.search(r'\[[\s\S]*\]', raw)
        if not match:
            return []
        items = json.loads(match.group())
    except Exception as e:
        logging.getLogger("main").warning("Memory synthesis failed: %s", e)
        return []

    # Telling the LLM "don't repeat yourself" in the prompt isn't reliable
    # on its own — confirmed empirically, it tends to re-cover the same
    # ground in fresh wording each run rather than converging. Semantic
    # similarity (same embeddings used for vault search/auto-linking)
    # catches "differently worded but same observation" far better than
    # text-level diffing; fall back to fuzzy text matching only if no
    # embedding provider is configured.
    from llm_client import embed_texts, cosine_similarity
    candidates = [(item.get("category", "pattern"), (item.get("content") or "").strip()) for item in items[:3]]
    candidates = [(cat, content) for cat, content in candidates if content]

    existing_vecs = None
    if existing and candidates:
        existing_vecs = embed_texts(existing, db_settings)

    created = []
    for category, content in candidates:
        is_duplicate = False
        if existing_vecs:
            content_vec = embed_texts([content], db_settings)
            if content_vec:
                is_duplicate = any(cosine_similarity(content_vec[0], v) >= 0.85 for v in existing_vecs)
        else:
            is_duplicate = any(difflib.SequenceMatcher(None, content.lower(), e.lower()).ratio() >= 0.6 for e in existing)

        if is_duplicate:
            continue
        m = models.AgentMemory(category=category, content=content)
        db.add(m)
        created.append(m)
    db.commit()

    # Keep the memory store small and current rather than growing forever —
    # drop the oldest, least-recently-referenced entries past the cap.
    overflow = db.query(models.AgentMemory).count() - _MAX_STORED_MEMORIES
    if overflow > 0:
        stale = (
            db.query(models.AgentMemory)
            .order_by(models.AgentMemory.last_used_at.asc().nulls_first(), models.AgentMemory.created_at.asc())
            .limit(overflow)
            .all()
        )
        for m in stale:
            db.delete(m)
        db.commit()

    for m in created:
        db.refresh(m)
    return created

@app.get("/memory")
def get_memory(db: Session = Depends(get_db)):
    return db.query(models.AgentMemory).order_by(models.AgentMemory.created_at.desc()).all()

@app.delete("/memory/{memory_id}")
def delete_memory(memory_id: int, db: Session = Depends(get_db)):
    db.query(models.AgentMemory).filter(models.AgentMemory.id == memory_id).delete()
    db.commit()
    return {"message": "Forgotten."}

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

@app.post("/agent/reflect")
def agent_reflect(db: Session = Depends(get_db)):
    """The ambient/always-on side of this app: an agentic loop meant to be
    triggered periodically (e.g. a weekly cron) rather than by direct user
    request. It looks at what you've recently liked and tagged, and:
      1. proposes NEW learning goals for themes that keep recurring but
         aren't covered by an active goal yet, and
      2. flags "open loops" — things you liked (signalling real interest)
         but never actually revisited via the recall quiz.
    Following the ambient-agent "Notify vs Review" pattern: it never
    creates goals or modifies anything on its own — it only proposes
    AgentSuggestion rows that a human reviews and explicitly accepts or
    dismisses in the UI.
    """
    import json
    from llm_client import llm, resolve_llm_config

    settings = db.query(models.Settings).first()
    llm_engine, ollama_model, api_key = resolve_llm_config(settings)

    now = datetime.datetime.now(datetime.timezone.utc)
    three_days_ago = now - datetime.timedelta(days=3)
    two_weeks_ago = now - datetime.timedelta(days=14)

    # Open-loop detection deliberately has NO lower bound on age — a note
    # liked 2 months ago and never revisited is if anything a more overdue
    # loop than one liked last week, not something to age out of view.
    liked_older_than_3_days = (
        db.query(models.Article)
        .filter(models.Article.liked.is_(True), models.Article.created_at <= three_days_ago)
        .all()
    )
    # The theme/new-goal synthesis is a recency signal instead ("what are
    # you currently drawn to"), so that part stays windowed to 2 weeks.
    recent_liked = [a for a in liked_older_than_3_days if a.created_at and a.created_at.replace(tzinfo=datetime.timezone.utc) >= two_weeks_ago]

    active_goal_titles = [g.title for g in db.query(models.LearningGoal).filter(models.LearningGoal.status == "active").all()]

    def already_suggested(title: str) -> bool:
        return db.query(models.AgentSuggestion).filter(
            models.AgentSuggestion.title == title,
            models.AgentSuggestion.status.in_(["pending", "accepted"]),
        ).first() is not None

    created = []

    # ── Open loops: liked (real signal of interest) but never reviewed ──
    # This is a deterministic DB check, not an LLM judgment call — more
    # reliable than asking the model to guess what counts as "neglected".
    for article in liked_older_than_3_days:
        reviewed = db.query(models.QuizQuestion).filter(
            models.QuizQuestion.article_id == article.id,
            models.QuizQuestion.review_count > 0,
        ).first()
        if reviewed:
            continue
        title = f"Revisit: {article.title}"[:200]
        if already_suggested(title):
            continue
        s = models.AgentSuggestion(
            type="open_loop",
            title=title,
            description=f"You liked this on {article.created_at.strftime('%b %d') if article.created_at else 'recently'} but haven't reviewed its recall questions yet.",
            payload=json.dumps({"article_id": article.id, "url": article.url}),
        )
        db.add(s)
        created.append(s)

    # ── Emerging themes → new goal proposals (this part genuinely benefits
    # from LLM synthesis — spotting a pattern across many tag sets isn't a
    # simple DB query). ──
    if recent_liked:
        tag_lines = []
        for a in recent_liked:
            try:
                tags = json.loads(a.tags) if a.tags else []
            except (TypeError, ValueError):
                tags = []
            if tags:
                tag_lines.append(f"- {a.title}: {', '.join(tags)}")
        if tag_lines:
            prompt = f"""Here are things the user liked/saved in the last two weeks, with their extracted concept tags:
{chr(10).join(tag_lines)}

Their current active learning goals are: {', '.join(active_goal_titles) or '(none)'}

If there's a clear recurring theme across at least 2-3 of the liked items that ISN'T already covered by an existing goal, propose ONE new learning goal for it. If nothing stands out as a genuine pattern, return an empty array — don't force a suggestion.
Return ONLY valid JSON: [{{"title": "short goal title", "description": "1-2 sentence why, referencing what they saved"}}] or []"""
            try:
                raw = llm.generate(prompt, model_type=llm_engine, ollama_model=ollama_model, api_key=api_key)
                import re as _re
                match = _re.search(r'\[[\s\S]*\]', raw)
                if match:
                    for item in json.loads(match.group())[:2]:
                        title = (item.get("title") or "").strip()
                        if not title or already_suggested(title) or title in active_goal_titles:
                            continue
                        s = models.AgentSuggestion(
                            type="new_goal",
                            title=title,
                            description=item.get("description", ""),
                            payload=json.dumps({"title": title, "description": item.get("description", "")}),
                        )
                        db.add(s)
                        created.append(s)
            except Exception as e:
                logging.getLogger("main").warning("Reflect theme synthesis failed: %s", e)

    db.commit()
    for s in created:
        db.refresh(s)

    # This is also where long-term memory gets updated — the reflect loop
    # is the one place that already looks at activity in aggregate rather
    # than one request at a time, so it's the natural place to distill
    # "what have I learned about this user" rather than doing it inline on
    # every single agent call.
    new_memories = _synthesize_memory(db, llm_engine, ollama_model, api_key, settings)

    # Notify (not review/act) — a lightweight heads-up if a webhook is
    # configured, same channel as the discovery digest.
    if created and settings and settings.webhook_url:
        lines = [f"🧠 Weekly Reflection — {len(created)} new suggestion(s):"]
        for s in created:
            lines.append(f"- [{s.type}] {s.title}")
        message = "\n".join(lines)
        try:
            requests.post(settings.webhook_url, json={"text": message, "content": message}, timeout=10)
        except Exception as e:
            logging.getLogger("main").warning("Reflect webhook notify failed: %s", e)

    return {"created": len(created), "suggestions": created, "new_memories": len(new_memories)}

@app.get("/suggestions")
def get_suggestions(status: str = "pending", db: Session = Depends(get_db)):
    return (
        db.query(models.AgentSuggestion)
        .filter(models.AgentSuggestion.status == status)
        .order_by(models.AgentSuggestion.created_at.desc())
        .all()
    )

class SuggestionAction(BaseModel):
    action: str  # "accept" | "dismiss"

@app.post("/suggestions/{suggestion_id}/action")
def act_on_suggestion(suggestion_id: int, req: SuggestionAction, db: Session = Depends(get_db)):
    import json
    s = db.query(models.AgentSuggestion).filter(models.AgentSuggestion.id == suggestion_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    if req.action == "dismiss":
        s.status = "dismissed"
        db.commit()
        return {"status": "dismissed"}

    if req.action != "accept":
        raise HTTPException(status_code=400, detail="action must be 'accept' or 'dismiss'")

    payload = json.loads(s.payload) if s.payload else {}
    if s.type == "new_goal":
        goal = models.LearningGoal(title=payload.get("title", s.title), description=payload.get("description", s.description))
        db.add(goal)
        s.status = "accepted"
        db.commit()
        db.refresh(goal)
        return {"status": "accepted", "goal_id": goal.id}

    if s.type == "open_loop":
        # "Accepting" a revisit nudge means: make its quiz questions due
        # again right now, so it surfaces at the top of /quiz/due.
        now = datetime.datetime.now(datetime.timezone.utc)
        db.query(models.QuizQuestion).filter(
            models.QuizQuestion.article_id == payload.get("article_id")
        ).update({"next_review_at": now})
        s.status = "accepted"
        db.commit()
        return {"status": "accepted"}

    s.status = "accepted"
    db.commit()
    return {"status": "accepted"}

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

@app.post("/settings/test-youtube-key")
def test_youtube_key(db: Session = Depends(get_db)):
    """Makes one real, minimal call to the YouTube Data API with the
    configured key and returns a specific, human-readable diagnosis
    instead of the discover feed just silently showing zero videos —
    Google's error responses (bad key, API not enabled, quota exceeded,
    referrer-restricted key) are all distinguishable from the response
    body, but that detail was previously only visible in server logs."""
    settings = db.query(models.Settings).first()
    api_key = settings.youtube_api_key if settings else None
    if not api_key:
        return {"ok": False, "message": "No YouTube API key is saved in Settings yet."}

    try:
        resp = requests.get(
            "https://www.googleapis.com/youtube/v3/search",
            params={"key": api_key, "q": "test", "part": "snippet", "type": "video", "maxResults": 1},
            timeout=10,
        )
    except Exception as e:
        return {"ok": False, "message": f"Could not reach the YouTube API: {e}"}

    if resp.status_code == 200:
        found = len(resp.json().get("items", []))
        return {"ok": True, "message": f"Key works — got {found} result(s) back from a live test search."}

    # Google's error body looks like: {"error": {"code": 403, "errors": [{"reason": "...", "message": "..."}]}}
    reason = None
    detail_message = None
    try:
        err = resp.json().get("error", {})
        detail_message = err.get("message")
        errors = err.get("errors", [])
        if errors:
            reason = errors[0].get("reason")
    except Exception:
        pass

    friendly = {
        "keyInvalid": "This API key isn't valid — double check you copied it correctly from Google Cloud Console.",
        "badRequest": "This API key isn't valid (Google rejected it outright) — double check you copied the whole key correctly, with no extra spaces, from Google Cloud Console.",
        "accessNotConfigured": "The YouTube Data API v3 isn't enabled for this key's Google Cloud project — go to APIs & Services > Library, search for it, and click Enable.",
        "quotaExceeded": "This key has hit its daily quota (10,000 units/day by default) — it'll reset at midnight Pacific time, or use a different key.",
        "dailyLimitExceededUnreg": "This key has hit its daily quota.",
        "ipRefererBlocked": "This key is restricted to specific websites/referrers, which blocks server-to-server calls from this backend. In Google Cloud Console, edit the key's Application restrictions to 'None' or 'IP addresses' (not 'HTTP referrers').",
    }.get(reason)

    message = friendly or detail_message or f"YouTube API returned HTTP {resp.status_code}."
    return {"ok": False, "message": message, "reason": reason}

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
    memory_context = _get_memory_context(db)

    response = research_agent.research(req.prompt, llm_engine, ollama_model, api_key, vault_context, memory_context)

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
    _generate_tags(article, llm_engine, ollama_model, api_key, db)

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

def _serialize_step(s: "models.LearningStep") -> dict:
    import json
    try:
        resources = json.loads(s.resources) if s.resources else []
    except (TypeError, ValueError):
        resources = []
    return {
        "id": s.id, "title": s.title, "description": s.description,
        "completed": s.completed, "order_index": s.order_index, "resources": resources,
    }

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
            "steps": [_serialize_step(s) for s in steps]
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
        
        from collector import find_learning_resources

        saved_steps = []
        for i, step in enumerate(data.get("steps", [])[:5]):
            resources = find_learning_resources(f"{data['title']} {step['title']}")
            s = models.LearningStep(
                goal_id=goal.id, title=step["title"], description=step.get("description", ""),
                order_index=i, resources=json.dumps(resources),
            )
            db.add(s)
            db.commit()
            db.refresh(s)
            saved_steps.append(_serialize_step(s))

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
    return _serialize_step(step)

@app.post("/goals/{goal_id}/steps/{step_id}/find-resources")
def find_step_resources(goal_id: int, step_id: int, db: Session = Depends(get_db)):
    """On-demand resource search for a single step — used both to refresh
    weak auto-generated results and to backfill resources for steps that
    were added manually (which don't get searched automatically, to keep
    'add a quick step' snappy)."""
    import json
    from collector import find_learning_resources

    step = db.query(models.LearningStep).filter(models.LearningStep.id == step_id, models.LearningStep.goal_id == goal_id).first()
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")

    goal = db.query(models.LearningGoal).filter(models.LearningGoal.id == goal_id).first()
    query = f"{goal.title} {step.title}" if goal else step.title
    resources = find_learning_resources(query)
    step.resources = json.dumps(resources)
    db.commit()
    return _serialize_step(step)

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

