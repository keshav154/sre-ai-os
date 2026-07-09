from sqlalchemy import Column, Integer, String, DateTime, Text, Float, Boolean
from sqlalchemy.sql import func
from database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    password_salt = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Article(Base):
    __tablename__ = "articles"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    author = Column(String)
    source = Column(String)
    url = Column(String, unique=True, index=True)
    content = Column(Text)
    summary = Column(Text)
    actionability_score = Column(Float)
    category = Column(String)
    saved_to_obsidian = Column(Boolean, default=False)
    liked = Column(Boolean, default=False)
    notes = Column(Text, nullable=True)  # AI-generated personal notes for liked items (distinct from the generic `summary`)
    embedding = Column(Text, nullable=True)  # JSON-encoded float vector for semantic search (RAG over the vault)
    tags = Column(Text, nullable=True)  # JSON-encoded list of LLM-extracted concept tags, used to build the knowledge graph
    related_articles = Column(Text, nullable=True)  # JSON-encoded [{id,title,url}] of the most similar other saved articles (auto-linked from embeddings)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Settings(Base):
    __tablename__ = "settings"
    
    id = Column(Integer, primary_key=True, index=True)
    keywords = Column(String, default="SRE, DevOps")
    llm_engine = Column(String, default="ollama")
    ollama_model = Column(String, default="llama3:latest")
    github_repo = Column(String, nullable=True)
    github_token = Column(String, nullable=True)
    openrouter_key = Column(String, nullable=True)
    openai_key = Column(String, nullable=True)
    anthropic_key = Column(String, nullable=True)
    gemini_key = Column(String, nullable=True)
    nvidia_nim_key = Column(String, nullable=True)
    youtube_api_key = Column(String, nullable=True)  # optional: enables precise dates via YouTube Data API v3
    custom_feeds = Column(String, default="https://devops.com/feed/,\nhttps://thenewstack.io/feed/,\nhttps://www.infoq.com/devops/news/rss/,\nhttps://aws.amazon.com/blogs/devops/feed/,\nhttps://netflixtechblog.com/feed,\nhttps://blog.cloudflare.com/rss/,\nhttps://kubernetes.io/feed.xml")
    webhook_url = Column(String, nullable=True)  # Slack/Discord-compatible incoming webhook for the discovery digest
    last_digest_at = Column(Float, nullable=True)  # unix timestamp of the last digest send, for incremental "what's new"
    obsidian_vault_path = Column(String, nullable=True)  # Absolute path to Obsidian vault
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class CVE(Base):
    __tablename__ = "cves"
    id = Column(Integer, primary_key=True, index=True)
    cve_id = Column(String, unique=True, index=True)
    description = Column(Text)
    severity = Column(String)
    status = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class LearningGoal(Base):
    __tablename__ = "learning_goals"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    description = Column(Text, nullable=True)
    progress = Column(Integer, default=0)  # 0-100
    status = Column(String, default="active")  # active, completed, paused
    color = Column(String, default="#3b82f6")  # hex color for UI
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class LearningStep(Base):
    __tablename__ = "learning_steps"
    id = Column(Integer, primary_key=True, index=True)
    goal_id = Column(Integer, index=True)
    title = Column(String)
    description = Column(Text, nullable=True)
    completed = Column(Boolean, default=False)
    order_index = Column(Integer, default=0)
    resources = Column(Text, nullable=True)  # JSON-encoded [{title,url,source}] — where to actually learn this step from
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class QuizQuestion(Base):
    __tablename__ = "quiz_questions"
    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, index=True)
    article_title = Column(String, nullable=True)
    question = Column(Text)
    answer = Column(Text)
    # Simplified spaced-repetition schedule (SM-2-lite): interval doubles on
    # a correct answer and resets to 1 day on a miss.
    interval_days = Column(Integer, default=1)
    review_count = Column(Integer, default=0)
    next_review_at = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class AgentSuggestion(Base):
    __tablename__ = "agent_suggestions"
    id = Column(Integer, primary_key=True, index=True)
    type = Column(String)  # 'new_goal' | 'open_loop' | 'theme'
    title = Column(String)
    description = Column(Text, nullable=True)
    payload = Column(Text, nullable=True)  # JSON-encoded extra data (e.g. proposed goal steps, article ids)
    status = Column(String, default="pending")  # pending | accepted | dismissed
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class AgentMemory(Base):
    """Long-term memory the agents accumulate about the user's interests
    and habits over time (distinct from the vault RAG, which is about
    saved *content* — this is about observed *patterns*), synthesized
    periodically by the reflect loop and injected into agent prompts so
    they build on prior understanding instead of starting cold every call."""
    __tablename__ = "agent_memory"
    id = Column(Integer, primary_key=True, index=True)
    category = Column(String, default="pattern")  # 'preference' | 'pattern' | 'fact'
    content = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(DateTime(timezone=True), nullable=True)

class ConceptNote(Base):
    """An evolving, synthesized note for one concept/tag — merges an
    article and its auto-linked related articles into a single note
    instead of leaving N separate per-article notes on the same idea.
    One row per concept; re-consolidating updates it in place rather than
    creating duplicates."""
    __tablename__ = "concept_notes"
    id = Column(Integer, primary_key=True, index=True)
    concept = Column(String, unique=True, index=True)
    content = Column(Text)
    source_article_ids = Column(Text)  # JSON-encoded list of article ids folded into this note
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class TimeLog(Base):
    __tablename__ = "time_logs"
    id = Column(Integer, primary_key=True, index=True)
    goal_id = Column(Integer, nullable=True, index=True)
    goal_title = Column(String, nullable=True)
    duration_minutes = Column(Integer)
    notes = Column(Text, nullable=True)
    log_date = Column(DateTime(timezone=True), server_default=func.now())
