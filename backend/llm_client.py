import os
from openai import OpenAI
from anthropic import Anthropic
import google.generativeai as genai
from config import settings

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
                return response.choices[0].message.content
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
                return response.choices[0].message.content
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
                return response.choices[0].message.content
            except Exception as e:
                return f"AI Summarization failed (OpenAI): {e}"
            
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
                return self.openrouter_client.chat.completions.create(
                    model="meta-llama/llama-3-8b-instruct:free",
                    messages=[{"role": "user", "content": prompt}]
                ).choices[0].message.content
            except: pass
            
        if self.ollama_client:
            try:
                return self.ollama_client.chat.completions.create(
                    model=ollama_model,
                    messages=[{"role": "user", "content": prompt}]
                ).choices[0].message.content
            except: pass
            
        if self.gemini_model:
            try:
                return self.gemini_model.generate_content(prompt).text
            except: pass
            
        if self.openai_client:
            try:
                return self.openai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": prompt}]
                ).choices[0].message.content
            except: pass
        
        return "AI Summarization bypassed. (Ensure you have Ollama running with 'llama3', or add an OPENROUTER_API_KEY to your .env file)."

llm = LLMClient()
