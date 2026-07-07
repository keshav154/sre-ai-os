from llm_client import llm

class SREAgent:
    def __init__(self, name: str, system_prompt: str):
        self.name = name
        self.system_prompt = system_prompt

    def run(self, user_input: str, llm_engine: str = "ollama", ollama_model: str = "llama3:latest", api_key: str = None) -> str:
        prompt = f"{self.system_prompt}\n\nUser Request: {user_input}\n\nResponse:"
        return llm.generate(prompt, model_type=llm_engine, ollama_model=ollama_model, api_key=api_key)

class ResearchAgent(SREAgent):
    def __init__(self):
        super().__init__("Research Agent", "You are an SRE Research AI. Summarize the user's topic and extract actionable insights. Return in Markdown format.")

    def research(self, topic: str, llm_engine: str = "ollama", ollama_model: str = "llama3:latest", api_key: str = None, vault_context: str = "", memory_context: str = "") -> str:
        request = f"Research and provide an executive summary on {topic}."
        if vault_context:
            request += (
                f"\n\nThe user has already saved these related notes in their personal vault — ground your "
                f"research in them where relevant and note where they add useful first-hand context, "
                f"but also bring in your own broader knowledge of the topic:\n\n{vault_context}"
            )
        if memory_context:
            request += (
                f"\n\nWhat you already know about this user from past activity — use it to judge what depth "
                f"or angle would actually be useful to them, don't just restate it:\n\n{memory_context}"
            )
        return self.run(request, llm_engine, ollama_model, api_key)

class RunbookAgent(SREAgent):
    def __init__(self):
        super().__init__("Runbook Agent", "You are an expert SRE. Create a detailed runbook for the provided incident description.")

    def generate_runbook(self, incident: str, llm_engine: str = "ollama", ollama_model: str = "llama3:latest", api_key: str = None) -> str:
        return self.run(f"Generate a runbook for: {incident}", llm_engine, ollama_model, api_key)

research_agent = ResearchAgent()
runbook_agent = RunbookAgent()
