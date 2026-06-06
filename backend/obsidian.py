import os
import json
from config import settings

class ObsidianWriter:
    def __init__(self):
        self.vault_path = settings.obsidian_vault_path

    def _ensure_dir(self, sub_path: str):
        full_path = os.path.join(self.vault_path, sub_path)
        os.makedirs(full_path, exist_ok=True)
        return full_path

    def write_article_note(self, title: str, content: str, folder: str = "Knowledge"):
        """Writes an article summary note into the vault"""
        safe_title = "".join([c for c in title if c.isalpha() or c.isdigit() or c==' ']).rstrip()
        folder_path = self._ensure_dir(folder)
        file_path = os.path.join(folder_path, f"{safe_title}.md")
        
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
            
        return file_path

    def write_runbook(self, title: str, content: str):
        return self.write_article_note(title, content, "Runbooks")

    def write_daily_digest(self, date_str: str, content: str):
        return self.write_article_note(f"Daily Digest {date_str}", content, "Daily-Digests")

obsidian_writer = ObsidianWriter()
