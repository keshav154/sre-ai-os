from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "sqlite:///./sre_ai_os.db"
    obsidian_vault_path: str = "../obsidian-vault"
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    gemini_api_key: str | None = None
    openrouter_api_key: str | None = None
    nvidia_nim_api_key: str | None = None
    ollama_base_url: str | None = "http://localhost:11434/v1"
    github_repo: str | None = None
    github_token: str | None = None
    jwt_secret_key: str = "insecure-dev-secret-change-me-in-production"
    jwt_expires_minutes: int = 60 * 24 * 14  # 14 days
    cron_secret: str = "insecure-dev-cron-secret-change-me-in-production"

    class Config:
        env_file = ".env"

settings = Settings()
