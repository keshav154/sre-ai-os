from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "sqlite:///./sre_ai_os.db"
    obsidian_vault_path: str = "../obsidian-vault"
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    gemini_api_key: str | None = None
    openrouter_api_key: str | None = None
    ollama_base_url: str | None = "http://localhost:11434/v1"

    class Config:
        env_file = ".env"

settings = Settings()
