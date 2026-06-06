from llm_client import llm
from obsidian import obsidian_writer

class SREAgent:
    def __init__(self, name: str, system_prompt: str):
        self.name = name
        self.system_prompt = system_prompt

    def run(self, user_input: str) -> str:
        prompt = f"{self.system_prompt}\n\nUser Request: {user_input}\n\nResponse:"
        return llm.generate(prompt)

class ResearchAgent(SREAgent):
    def __init__(self):
        super().__init__("Research Agent", "You are an SRE Research AI. Summarize the user's topic and extract actionable insights. Return in Markdown format.")
    
    def process_and_save(self, topic: str):
        response = self.run(f"Research and provide an executive summary on {topic}.")
        obsidian_writer.write_article_note(f"Research - {topic}", response)
        return response

class RunbookAgent(SREAgent):
    def __init__(self):
        super().__init__("Runbook Agent", "You are an expert SRE. Create a detailed runbook for the provided incident description.")
        
    def generate_runbook(self, incident: str):
        response = self.run(f"Generate a runbook for: {incident}")
        obsidian_writer.write_runbook(f"Runbook - {incident}", response)
        return response

research_agent = ResearchAgent()
runbook_agent = RunbookAgent()
