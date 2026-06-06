import datetime
from models import Article
from database import get_db
from obsidian import obsidian_writer
from llm_client import llm
import requests
from bs4 import BeautifulSoup
from youtube_transcript_api import YouTubeTranscriptApi
import re
from duckduckgo_search import DDGS

def scrape_youtube_transcript(video_id: str) -> str:
    try:
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
        transcript = " ".join([t['text'] for t in transcript_list])
        return transcript
    except Exception as e:
        return f"Could not fetch YouTube transcript: {e}"

def extract_youtube_id(url: str):
    match = re.search(r"(?:v=|\/)([0-9A-Za-z_-]{11}).*", url)
    return match.group(1) if match else None

def ingest_url(url: str, db, summarize: bool = False):
    from models import Article, Settings
    
    # Check if already exists
    existing = db.query(Article).filter(Article.url == url).first()
    if existing:
        return {"title": existing.title, "summary": existing.summary, "status": "already_exists"}
        
    title = "Ingested Content"
    content = ""
    source = "Web"
    
    # Known bot-challenge / gateway titles to reject
    JUNK_TITLES = [
        "just a moment", "access denied", "attention required", "are you human",
        "ddos protection", "checking your browser", "please wait", "cloudflare",
        "403 forbidden", "404 not found", "error"
    ]
    
    try:
        if "youtube.com" in url or "youtu.be" in url:
            video_id = extract_youtube_id(url)
            if video_id:
                content = scrape_youtube_transcript(video_id)
                source = "YouTube"
                title = f"YouTube Video ({video_id})"
        else:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
            response = requests.get(url, headers=headers, timeout=10)
            soup = BeautifulSoup(response.text, 'html.parser')
            raw_title = soup.title.string.strip() if soup.title else url
            
            # Reject Cloudflare / bot-challenge pages
            if any(j in raw_title.lower() for j in JUNK_TITLES):
                return {"error": f"Blocked by bot protection: '{raw_title}'. This site requires a browser to access.", "status": "blocked"}
            
            title = raw_title
            paragraphs = soup.find_all('p')
            content = " ".join([p.get_text() for p in paragraphs])
            
            # Reject if content is suspiciously short (bot wall with no text)
            if len(content.strip()) < 100:
                return {"error": f"No readable content found at this URL (possible paywall or bot protection).", "status": "blocked"}
            
            source = "Web/Article"
    except Exception as e:
        content = f"Failed to ingest content: {e}"

    if not content.strip():
        content = "No readable text could be extracted."

    if summarize:
        settings = db.query(Settings).first()
        llm_engine = settings.llm_engine if settings else "ollama"
        ollama_model = settings.ollama_model if settings else "llama3:latest"
        api_key = None
        if settings:
            if llm_engine == "openrouter": api_key = settings.openrouter_key
            elif llm_engine == "openai": api_key = settings.openai_key
            elif llm_engine == "anthropic": api_key = settings.anthropic_key
            elif llm_engine == "gemini": api_key = settings.gemini_key
        
        prompt = f"You are an SRE AI. Summarize the following content in detail, extracting the most important key learning points for an SRE/DevOps engineer. Here is the content:\n\n{content[:15000]}"
        summary = llm.generate(prompt, model_type=llm_engine, ollama_model=ollama_model, api_key=api_key)
    else:
        summary = "Pending AI Summarization. Click to generate insights."
    
    db_article = Article(
        title=title,
        author="Ingested",
        source=source,
        url=url,
        content=content,
        summary=summary,
        category="Learning",
        saved_to_obsidian=False
    )
    db.add(db_article)
    db.commit()
    return {"title": title, "summary": summary, "status": "success"}

import feedparser
from youtube_search import YoutubeSearch
import urllib.parse
import requests

class SortedYoutubeSearch(YoutubeSearch):
    def _search(self):
        encoded_search = urllib.parse.quote_plus(self.search_terms)
        BASE_URL = "https://youtube.com"
        # sp=CAI%3D → Sort by Upload Date
        url = f"{BASE_URL}/results?search_query={encoded_search}&sp=CAI%3D"
        
        attempts = 1
        response = requests.get(url, proxies=self.proxy, timeout=self.timeout).text
        while "ytInitialData" not in response and attempts <= self.retries:
            response = requests.get(url, proxies=self.proxy, timeout=self.timeout).text
            attempts += 1
            
        results = self._parse_html(response)
        if self.max_results is not None and len(results) > self.max_results:
            return results[: self.max_results]
        return results

import re
import time

def get_rss_timestamp(entry):
    if hasattr(entry, 'published_parsed') and entry.published_parsed:
        return time.mktime(entry.published_parsed)
    return time.time()

def parse_yt_time(time_str):
    if not time_str: return time.time()
    now = time.time()
    time_str = str(time_str).lower()
    try:
        match = re.search(r'(\d+)', time_str)
        if match:
            val = int(match.group(1))
            if 'second' in time_str or 'sec' in time_str: return now - val
            if 'minute' in time_str or 'min' in time_str: return now - val * 60
            if 'hour' in time_str or 'hr' in time_str: return now - val * 3600
            if 'day' in time_str or 'd ' in time_str or re.search(r'\bd\b', time_str): return now - val * 86400
            if 'week' in time_str or 'wk' in time_str: return now - val * 604800
            if 'month' in time_str or 'mo' in time_str: return now - val * 2592000
            if 'year' in time_str or 'yr' in time_str: return now - val * 31536000
    except:
        pass
    return now

def clean_html(raw_html):
    if not raw_html: return ""
    cleanr = re.compile('<.*?>')
    cleantext = re.sub(cleanr, '', raw_html).strip()
    return cleantext[:150] + "..." if len(cleantext) > 150 else cleantext

def live_discover(db):
    import concurrent.futures
    from models import Settings

    settings = db.query(Settings).first()
    keywords_str = settings.keywords if settings else "SRE, DevOps"
    custom_feeds_str = settings.custom_feeds if settings else "https://devops.com/feed/,\nhttps://thenewstack.io/feed/"
    keywords = [kw.strip() for kw in keywords_str.split(",") if kw.strip()]
    general_feeds = [f.strip() for f in custom_feeds_str.split(",") if f.strip()]

    results = []

    def fetch_medium(keyword):
        local_results = []
        try:
            feed_url = f"https://medium.com/feed/tag/{keyword.lower().replace(' ', '-')}"
            feed = feedparser.parse(feed_url)
            for entry in feed.entries[:25]: 
                url = entry.link
                if url:
                    ts = get_rss_timestamp(entry)
                    local_results.append({
                        "title": entry.title,
                        "url": url,
                        "source": "Medium",
                        "summary": clean_html(entry.get('summary', '')),
                        "saved": False,
                        "timestamp": ts,
                        "date_str": datetime.datetime.fromtimestamp(ts).strftime("%b %d, %Y")
                    })
        except: pass
        return local_results

    def fetch_youtube(keyword):
        local_results = []
        two_years_ago = time.time() - (2 * 365 * 24 * 3600)
        try:
            # Search multiple variations to get more videos
            variations = [f"{keyword} tutorial", f"{keyword} crash course", f"{keyword} explained"]
            for var in variations:
                yt_results = SortedYoutubeSearch(var, max_results=20).to_dict()
                for yt in yt_results:
                    yt_url = f"https://youtube.com{yt['url_suffix']}"
                    if any(r['url'] == yt_url for r in local_results):
                        continue
                    ts = parse_yt_time(yt.get('publish_time'))
                    # Filter out videos older than 2 years
                    if ts < two_years_ago:
                        continue
                    local_results.append({
                        "title": yt['title'],
                        "url": yt_url,
                        "source": "YouTube",
                        "thumbnail": yt.get('thumbnails', [])[0] if yt.get('thumbnails') else None,
                        "summary": "YouTube Video",
                        "saved": False,
                        "timestamp": ts,
                        "date_str": yt.get('publish_time', 'Recently')
                    })
        except: pass
        return local_results

    def fetch_custom(g_feed):
        local_results = []
        try:
            feed = feedparser.parse(g_feed)
            for entry in feed.entries[:20]:
                ts = get_rss_timestamp(entry)
                domain_match = re.search(r'https?://(?:www\.)?([^/]+)', g_feed)
                source_name = domain_match.group(1) if domain_match else "Custom RSS"
                local_results.append({
                    "title": entry.title,
                    "url": entry.link,
                    "source": source_name,
                    "thumbnail": None,
                    "summary": clean_html(entry.get('summary', '')),
                    "saved": False,
                    "timestamp": ts,
                    "date_str": datetime.datetime.fromtimestamp(ts).strftime("%b %d, %Y")
                })
        except: pass
        return local_results

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = []
            for keyword in keywords:
                futures.append(executor.submit(fetch_medium, keyword))
                futures.append(executor.submit(fetch_youtube, keyword))
            for g_feed in general_feeds:
                futures.append(executor.submit(fetch_custom, g_feed))
            
            for future in concurrent.futures.as_completed(futures):
                try:
                    res = future.result()
                    if res: results.extend(res)
                except: pass
    except Exception as e:
        print("Discover error", e)
    
    # Sort results from newest to oldest
    results.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
    return results
