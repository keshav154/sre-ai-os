import os
import logging
import requests as _requests
from openai import OpenAI
from anthropic import Anthropic
import google.generativeai as genai
from config import settings

logger = logging.getLogger("llm_client")

def _extract_message_text(message) -> str:
    """Pulls the actual text out of an OpenAI-SDK-shaped chat message.
    Some models — reasoning models especially, which several of the free
    OpenRouter/NVIDIA NIM models are — put their answer in a separate
    `reasoning`/`reasoning_content` field and leave `content` as None or
    empty, since they treat `content` as the "final answer after
    reasoning" slot and only fill it once reasoning is complete (or not at
    all, depending on the provider's OpenAI-compat shim). Silently
    returning that None was exactly the "no output, no error" bug — this
    makes sure something is always returned, and it's the actual model
    output rather than nothing."""
    content = getattr(message, "content", None)
    if content:
        return content
    reasoning = getattr(message, "reasoning", None) or getattr(message, "reasoning_content", None)
    if reasoning:
        return reasoning
    return "(The model returned an empty response. Try again, or switch models/engines in Settings — some free-tier models return nothing under load.)"

class LLMClient:
    def __init__(self):
        self.openai_client = OpenAI(api_key=settings.openai_api_key) if settings.openai_api_key else None
        
        # OpenRouter uses the OpenAI SDK but points to a different base URL
        self.openrouter_client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=settings.openrouter_api_key,
        ) if settings.openrouter_api_key else None
        
        # Ollama support using OpenAI SDK compatibility
        self.ollama_client = OpenAI(
            base_url=settings.ollama_base_url,
            api_key="ollama", # dummy key required by SDK
        ) if settings.ollama_base_url else None

        # NVIDIA NIM (build.nvidia.com / integrate.api.nvidia.com) is also
        # OpenAI SDK-compatible.
        self.nvidia_nim_client = OpenAI(
            base_url="https://integrate.api.nvidia.com/v1",
            api_key=settings.nvidia_nim_api_key,
        ) if settings.nvidia_nim_api_key else None

        self.anthropic_client = Anthropic(api_key=settings.anthropic_api_key) if settings.anthropic_api_key else None
        if settings.gemini_api_key:
            genai.configure(api_key=settings.gemini_api_key)
            self.gemini_model = genai.GenerativeModel('gemini-1.5-flash')
        else:
            self.gemini_model = None

    def generate(self, prompt: str, model_type: str = "ollama", ollama_model: str = "llama3:latest", api_key: str = None) -> str:
        model_name = ollama_model if ollama_model else "llama3:latest"
        
        # Fallback logic if a key is not present
        if model_type == "ollama":
            # Ollama does not need an API key
            client = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama", timeout=15, max_retries=0) if not self.ollama_client else self.ollama_client
            try:
                response = client.chat.completions.create(
                    model=model_name,
                    messages=[{"role": "user", "content": prompt}]
                )
                return _extract_message_text(response.choices[0].message)
            except Exception as e:
                return f"AI Summarization failed: {e}. Please check your Ollama Model Name in Settings."
        
        elif model_type == "openrouter":
            client = OpenAI(api_key=api_key, base_url="https://openrouter.ai/api/v1", timeout=15, max_retries=0) if api_key else self.openrouter_client
            if not client: return "AI Summarization bypassed. Please add an OPENROUTER_API_KEY to your settings."
            try:
                response = client.chat.completions.create(
                    model=model_name or "meta-llama/llama-3-8b-instruct:free",
                    messages=[{"role": "user", "content": prompt}]
                )
                return _extract_message_text(response.choices[0].message)
            except Exception as e:
                return f"AI Summarization failed (OpenRouter): {e}"
            
        elif model_type == "openai":
            client = OpenAI(api_key=api_key, timeout=15, max_retries=0) if api_key else self.openai_client
            if not client: return "AI Summarization bypassed. Please add an OPENAI_API_KEY to your settings."
            try:
                response = client.chat.completions.create(
                    model=model_name or "gpt-4o",
                    messages=[{"role": "user", "content": prompt}]
                )
                return _extract_message_text(response.choices[0].message)
            except Exception as e:
                return f"AI Summarization failed (OpenAI): {e}"
            
        elif model_type == "nvidia_nim":
            client = OpenAI(api_key=api_key, base_url="https://integrate.api.nvidia.com/v1", timeout=15, max_retries=0) if api_key else self.nvidia_nim_client
            if not client: return "AI Summarization bypassed. Please add an NVIDIA_NIM_API_KEY to your settings."
            try:
                response = client.chat.completions.create(
                    model=model_name or "meta/llama-3.1-8b-instruct",
                    messages=[{"role": "user", "content": prompt}]
                )
                return _extract_message_text(response.choices[0].message)
            except Exception as e:
                return f"AI Summarization failed (NVIDIA NIM): {e}"

        elif model_type == "anthropic":
            client = Anthropic(api_key=api_key) if api_key else self.anthropic_client
            if not client: return "AI Summarization bypassed. Please add an ANTHROPIC_API_KEY to your settings."
            try:
                response = client.messages.create(
                    model=model_name or "claude-3-opus-20240229",
                    max_tokens=1000,
                    messages=[{"role": "user", "content": prompt}]
                )
                return response.content[0].text
            except Exception as e:
                return f"AI Summarization failed (Anthropic): {e}"
            
        elif model_type == "gemini":
            if api_key:
                genai.configure(api_key=api_key)
            if not (api_key or self.gemini_model): return "AI Summarization bypassed. Please add a GEMINI_API_KEY to your settings."
            try:
                model = genai.GenerativeModel(model_name or 'gemini-1.5-pro-latest')
                response = model.generate_content(prompt)
                return response.text
            except Exception as e:
                return f"AI Summarization failed (Gemini): {e}"
        
        # Fallback if preferred model is not configured
        if self.openrouter_client:
            try:
                response = self.openrouter_client.chat.completions.create(
                    model="meta-llama/llama-3-8b-instruct:free",
                    messages=[{"role": "user", "content": prompt}]
                )
                return _extract_message_text(response.choices[0].message)
            except Exception:
                pass

        if self.ollama_client:
            try:
                response = self.ollama_client.chat.completions.create(
                    model=ollama_model,
                    messages=[{"role": "user", "content": prompt}]
                )
                return _extract_message_text(response.choices[0].message)
            except Exception:
                pass

        if self.gemini_model:
            try:
                return self.gemini_model.generate_content(prompt).text
            except Exception:
                pass

        if self.openai_client:
            try:
                response = self.openai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": prompt}]
                )
                return _extract_message_text(response.choices[0].message)
            except Exception:
                pass
        
        return "AI Summarization bypassed. (Ensure you have Ollama running with 'llama3', or add an OPENROUTER_API_KEY to your .env file)."

llm = LLMClient()

# Shared "which engine + model + key" lookup used by every endpoint that
# calls llm.generate() on behalf of the user's configured Settings, so
# adding a new provider only requires updating it in one place.
_ENGINE_KEY_FIELDS = {
    "openrouter": "openrouter_key",
    "openai": "openai_key",
    "anthropic": "anthropic_key",
    "gemini": "gemini_key",
    "nvidia_nim": "nvidia_nim_key",
}

def resolve_llm_config(settings):
    llm_engine = settings.llm_engine if settings else "ollama"
    ollama_model = settings.ollama_model if settings else "llama3:latest"
    api_key = None
    field = _ENGINE_KEY_FIELDS.get(llm_engine)
    if settings and field:
        api_key = getattr(settings, field, None)
    return llm_engine, ollama_model, api_key

def embed_texts(texts: list, db_settings=None):
    """Embeds a batch of strings for RAG-style retrieval. Tries OpenAI's
    embedding API first (if a key is configured, either per-user in
    Settings or via the OPENAI_API_KEY env var), then falls back to a local
    Ollama model (requires `ollama pull nomic-embed-text`). Returns None if
    neither is available — callers should degrade gracefully (e.g. skip
    semantic search/clustering rather than failing outright)."""
    if not texts:
        return []

    openai_key = (getattr(db_settings, "openai_key", None) if db_settings else None) or settings.openai_api_key
    if openai_key:
        try:
            client = OpenAI(api_key=openai_key)
            resp = client.embeddings.create(model="text-embedding-3-small", input=texts)
            return [d.embedding for d in resp.data]
        except Exception as e:
            logger.warning("OpenAI embeddings failed, falling back: %s", e)

    if settings.ollama_base_url:
        try:
            base = settings.ollama_base_url.rstrip("/")
            if base.endswith("/v1"):
                base = base[:-3]
            out = []
            for text in texts:
                resp = _requests.post(
                    f"{base}/api/embeddings",
                    json={"model": "nomic-embed-text", "prompt": text[:8000]},
                    timeout=30,
                )
                resp.raise_for_status()
                out.append(resp.json()["embedding"])
            return out
        except Exception as e:
            logger.warning("Ollama embeddings failed: %s", e)

    return None

def cosine_similarity(a: list, b: list) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
