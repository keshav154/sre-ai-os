from sqlalchemy import Column, Integer, String, DateTime, Text, Float, Boolean
from sqlalchemy.sql import func
from database import Base

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
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Settings(Base):
    __tablename__ = "settings"
    
    id = Column(Integer, primary_key=True, index=True)
    keywords = Column(String, default="SRE, DevOps")
    llm_engine = Column(String, default="ollama")
    ollama_model = Column(String, default="llama3:latest")
    openrouter_key = Column(String, nullable=True)
    openai_key = Column(String, nullable=True)
    anthropic_key = Column(String, nullable=True)
    gemini_key = Column(String, nullable=True)
    custom_feeds = Column(String, default="https://devops.com/feed/,\nhttps://thenewstack.io/feed/,\nhttps://www.infoq.com/devops/news/rss/,\nhttps://aws.amazon.com/blogs/devops/feed/,\nhttps://netflixtechblog.com/feed,\nhttps://blog.cloudflare.com/rss/,\nhttps://kubernetes.io/feed.xml")
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
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class TimeLog(Base):
    __tablename__ = "time_logs"
    id = Column(Integer, primary_key=True, index=True)
    goal_id = Column(Integer, nullable=True, index=True)
    goal_title = Column(String, nullable=True)
    duration_minutes = Column(Integer)
    notes = Column(Text, nullable=True)
    log_date = Column(DateTime(timezone=True), server_default=func.now())
