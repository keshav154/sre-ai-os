import datetime
import difflib
import logging
import random
from models import Article
from database import get_db
from obsidian import obsidian_writer
from llm_client import llm
import requests
from bs4 import BeautifulSoup
from youtube_transcript_api import YouTubeTranscriptApi
import re
from ddgs import DDGS

logger = logging.getLogger("collector")

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

# Known bot-challenge / gateway phrases — checked against both the page
# title AND a slice of the body text, since some challenge pages (e.g.
# reCAPTCHA interstitials) keep a normal-looking server-rendered <title>
# while the actual block message is in the body.
_JUNK_PHRASES = [
    "just a moment", "access denied", "attention required", "are you human",
    "ddos protection", "checking your browser", "please wait", "cloudflare",
    "403 forbidden", "404 not found",
    "verify you are human", "verify you're human", "i'm not a robot", "im not a robot",
    "unusual traffic", "detected unusual traffic", "captcha", "bot detection",
    "suspicious activity", "robot check", "prove you're not a robot",
]
# Status codes bot walls/rate limiters commonly respond with, even when the
# HTML body looks superficially page-shaped.
_BLOCKED_STATUS_CODES = {403, 429, 503}

def _fetch_direct(url: str):
    """First attempt: fetch the page ourselves. Returns (title, content) on
    success, or (None, reason) if it looks blocked/unreadable."""
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.text, 'html.parser')
        raw_title = soup.title.string.strip() if soup.title else url
    except Exception as e:
        return None, f"Could not reach this URL: {e}"

    paragraphs = soup.find_all('p')
    body_text = " ".join([p.get_text() for p in paragraphs])
    body_sniff = body_text[:1500].lower()

    # A 403/429/503 is a strong signal but not absolute on its own — a few
    # CDNs return one of these codes while still serving a full, usable
    # page (e.g. a stale cached copy). Only treat it as a hard block when
    # the body also looks like an actual block page (thin content or a
    # junk-phrase match), otherwise fall through to the normal checks.
    looks_like_block_page = len(body_text.strip()) < 250 or any(j in body_sniff for j in _JUNK_PHRASES)
    if response.status_code in _BLOCKED_STATUS_CODES and looks_like_block_page:
        return None, f"Blocked by bot protection (HTTP {response.status_code})"

    if any(j in raw_title.lower() for j in _JUNK_PHRASES) or any(j in body_sniff for j in _JUNK_PHRASES):
        return None, f"Blocked by bot protection: '{raw_title}'"

    if len(body_text.strip()) < 100:
        return None, "No readable content found (possible paywall or bot protection)"

    return raw_title, body_text

def fetch_via_jina_reader(url: str):
    """Second attempt when the direct fetch is blocked: proxies the page
    through Jina AI's free Reader service (https://r.jina.ai), which
    renders it server-side on different infra/IP reputation than ours and
    returns clean markdown (prefixed with a "Title: ..." line). No API key
    needed for light use. Returns (title, content), or (None, None) on any
    failure — this is a best-effort fallback, not a guarantee."""
    try:
        resp = requests.get(f"https://r.jina.ai/{url}", timeout=20)
        resp.raise_for_status()
        text = resp.text.strip()
        if len(text) < 100:
            return None, None
        title_match = re.match(r'Title:\s*(.+)', text)
        title = title_match.group(1).strip() if title_match else None
        return title, text
    except Exception as e:
        logger.warning("Jina Reader fallback failed for %s: %s", url, e)
        return None, None

def ingest_url(url: str, db, summarize: bool = False, fallback_title: str = None, fallback_content: str = None):
    from models import Article, Settings

    # Check if already exists
    existing = db.query(Article).filter(Article.url == url).first()
    if existing:
        return {"title": existing.title, "summary": existing.summary, "status": "already_exists"}

    title = "Ingested Content"
    content = ""
    source = "Web"

    if "youtube.com" in url or "youtu.be" in url:
        video_id = extract_youtube_id(url)
        if video_id:
            content = scrape_youtube_transcript(video_id)
            source = "YouTube"
            title = f"YouTube Video ({video_id})"
    else:
        block_reason = None

        # 1. Try fetching it ourselves.
        direct_title, direct_result = _fetch_direct(url)
        if direct_title is not None:
            title, content = direct_title, direct_result
        else:
            block_reason = direct_result
            logger.warning("Direct fetch blocked for %s: %s", url, block_reason)

            # 2. Try Jina Reader — different infra/IP than ours, works around
            # a lot of the bot-walls that block Render's data-center IPs.
            jina_title, jina_content = fetch_via_jina_reader(url)
            if jina_content:
                title = jina_title or fallback_title or url
                content = jina_content
                logger.info("Recovered %s via Jina Reader fallback", url)
            # 3. Last resort: the RSS preview the discover feed already had
            # for this item, if the caller passed one along. It's short (a
            # preview, not the full article) but still better than failing.
            elif fallback_content and len(fallback_content.strip()) >= 40:
                title = fallback_title or url
                content = fallback_content
                logger.info("Recovered %s via RSS summary fallback", url)
            else:
                return {"error": f"{block_reason}. Tried an alternate fetch route too, but couldn't get readable content — this site may require a real browser to access.", "status": "blocked"}

        source = "Web/Article"

    if not content.strip():
        content = "No readable text could be extracted."

    if summarize:
        from llm_client import resolve_llm_config
        settings = db.query(Settings).first()
        llm_engine, ollama_model, api_key = resolve_llm_config(settings)

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
        import time as _time

        encoded_search = urllib.parse.quote_plus(self.search_terms)
        BASE_URL = "https://youtube.com"
        # sp=CAI%3D → Sort by Upload Date
        url = f"{BASE_URL}/results?search_query={encoded_search}&sp=CAI%3D"

        attempts = 1
        response = requests.get(url, proxies=self.proxy, timeout=self.timeout).text
        while "ytInitialData" not in response and attempts <= self.retries:
            # Exponential backoff + jitter instead of hammering YouTube
            # immediately on failure (which risks IP-based throttling/CAPTCHA
            # walls, especially now that we issue 6 variations x N keywords
            # per discover run).
            backoff = min(2 ** attempts, 10) + random.uniform(0, 1)
            _time.sleep(backoff)
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
    # Returns 0 (epoch) when the string can't be parsed, so unparseable
    # entries sink to the bottom of a "newest first" sort instead of
    # masquerading as brand new.
    if not time_str: return 0
    now = time.time()
    time_str = str(time_str).lower()
    try:
        # Match the number together with its unit word so prefixes like
        # "Streamed "/"Premiered " can't be mistaken for a "d" (day) unit.
        match = re.search(r'(\d+)\s*(second|sec|minute|min|hour|hr|day|week|wk|month|mo|year|yr)', time_str)
        if match:
            val = int(match.group(1))
            unit = match.group(2)
            if unit in ('second', 'sec'): return now - val
            if unit in ('minute', 'min'): return now - val * 60
            if unit in ('hour', 'hr'): return now - val * 3600
            if unit == 'day': return now - val * 86400
            if unit in ('week', 'wk'): return now - val * 604800
            if unit in ('month', 'mo'): return now - val * 2592000
            if unit in ('year', 'yr'): return now - val * 31536000
    except Exception:
        logger.debug("Could not parse YouTube publish time %r", time_str)
    return 0

def clean_html(raw_html):
    if not raw_html: return ""
    cleanr = re.compile('<.*?>')
    cleantext = re.sub(cleanr, '', raw_html).strip()
    return cleantext[:150] + "..." if len(cleantext) > 150 else cleantext

def _title_matches_keyword(title: str, keyword: str) -> bool:
    """YouTube search (both the scraped web UI and the official Data API)
    is fuzzy/recommendation-influenced, not a strict keyword match — a
    query like "SRE deep dive" can surface a completely unrelated video
    (a TV recap, a celebrity interview) that happens to rank for the
    generic "deep dive" part of the query while having nothing to do with
    "SRE". Requiring the keyword to actually appear in the video's own
    title is a simple, reliable backstop against that drift."""
    if not title or not keyword:
        return False
    return bool(re.search(r'\b' + re.escape(keyword.strip()) + r'\b', title, re.IGNORECASE))

def fetch_youtube_via_api(keyword: str, api_key: str, two_years_ago: float, pages: int = 3):
    """Uses the official YouTube Data API v3 for exact publish timestamps
    instead of scraping+guessing relative-time text. Used when
    Settings.youtube_api_key is configured. Pages through up to `pages` *
    50 results (the API's per-page max) to widen the result pool.

    Uses order=relevance rather than order=date: `date` sorts purely by
    recency regardless of how weakly a video matches the query, which
    combined with _title_matches_keyword() below (a title-must-contain-the-
    keyword backstop) was filtering out nearly every result — the newest
    matching-anything videos rarely have the literal keyword in their
    title. `relevance` keeps candidates that are actually about the topic;
    live_discover() re-sorts everything by real publish time afterward
    anyway, so recency ordering isn't lost, just the candidate pool changes."""
    local_results = []
    page_token = None
    try:
        for _ in range(pages):
            params = {
                "key": api_key,
                "q": keyword,
                "part": "snippet",
                "type": "video",
                "order": "relevance",
                "maxResults": 50,
                "publishedAfter": datetime.datetime.utcfromtimestamp(two_years_ago).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            if page_token:
                params["pageToken"] = page_token
            resp = requests.get("https://www.googleapis.com/youtube/v3/search", params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            for item in data.get("items", []):
                video_id = item.get("id", {}).get("videoId")
                snippet = item.get("snippet", {})
                if not video_id:
                    continue
                if not _title_matches_keyword(snippet.get("title", ""), keyword):
                    continue
                published_at = snippet.get("publishedAt")
                try:
                    ts = datetime.datetime.strptime(published_at, "%Y-%m-%dT%H:%M:%SZ").replace(
                        tzinfo=datetime.timezone.utc
                    ).timestamp()
                except (TypeError, ValueError):
                    ts = 0
                thumbnails = snippet.get("thumbnails", {})
                thumb = (thumbnails.get("medium") or thumbnails.get("default") or {}).get("url")
                local_results.append({
                    "title": snippet.get("title", "Untitled"),
                    "url": f"https://youtube.com/watch?v={video_id}",
                    "source": "YouTube",
                    "thumbnail": thumb,
                    "summary": "YouTube Video",
                    "saved": False,
                    "timestamp": ts,
                    "date_str": datetime.datetime.fromtimestamp(ts).strftime("%b %d, %Y") if ts else "Recently",
                })
            page_token = data.get("nextPageToken")
            if not page_token:
                break
    except requests.exceptions.HTTPError as e:
        # The response body usually has the actual reason (bad key, API not
        # enabled on the project, quota exceeded) — surfacing it makes a
        # misconfigured key diagnosable from logs instead of just silently
        # returning zero videos.
        body = e.response.text[:300] if e.response is not None else ""
        logger.warning("YouTube Data API search failed for %r: %s | %s", keyword, e, body)
    except Exception as e:
        logger.warning("YouTube Data API search failed for %r: %s", keyword, e)
    return local_results

# Simple process-local TTL cache so repeated /discover calls (page reloads,
# polling) don't re-scrape every source on every request.
_discover_cache = {"key": None, "expires_at": 0, "results": None}
_DISCOVER_CACHE_TTL_SECONDS = 300

_TITLE_JUNK = re.compile(
    r'\s*[\|\-–—]\s*(by\s+.+|medium|jun|jul|aug|\d{4}).*$',
    re.IGNORECASE,
)
_TITLE_STOPWORDS = {
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'your', 'you', 'are',
    'guide', 'complete', 'full', 'course', 'crash', 'tutorial', 'beginner',
    'beginners', 'explained', 'introduction', 'certification', 'quick',
}

def _title_tokens(title: str) -> set:
    # Strips common "| by Author | Jun, 2026 | Medium"-style suffixes, then
    # tokenizes and drops generic words shared by unrelated templated
    # titles (e.g. "X Certification in 2026: A Beginner's Guide to Y")
    # so clustering keys on the *distinctive* subject matter, not boilerplate.
    t = _TITLE_JUNK.sub('', title or '').lower()
    words = re.findall(r'[a-z0-9]+', t)
    return {w for w in words if len(w) > 2 and w not in _TITLE_STOPWORDS}

def _cluster_near_duplicates(items: list, threshold: float = 0.5) -> list:
    """The same story often appears as a Medium post AND several YouTube
    videos. Rather than a costly embedding call per item, this uses cheap
    token-set Jaccard similarity on normalized titles to greedily group
    near-duplicates (more robust than raw character-sequence similarity,
    which false-positives on shared templated phrasing like "X
    Certification in 2026: A Guide to Y" across unrelated tools).
    The newest item in each cluster stays visible with a `related` list of
    the others attached; the rest are flagged `hidden_duplicate` so the
    frontend can collapse them instead of showing 5 cards for one story."""
    clusters = []  # list of (token_set, representative_item)
    for item in items:  # items are already newest-first
        tokens = _title_tokens(item.get('title', ''))
        match = None
        if len(tokens) >= 2:
            for cluster_tokens, rep in clusters:
                union = tokens | cluster_tokens
                if not union:
                    continue
                jaccard = len(tokens & cluster_tokens) / len(union)
                if jaccard >= threshold:
                    match = rep
                    break
        if match is not None:
            match.setdefault('related', []).append({
                "title": item['title'], "url": item['url'], "source": item['source'],
            })
            item['hidden_duplicate'] = True
        else:
            clusters.append((tokens, item))
    return items

def live_discover(db, force_refresh: bool = False):
    import concurrent.futures
    from models import Settings

    settings = db.query(Settings).first()
    keywords_str = settings.keywords if settings else "SRE, DevOps"
    custom_feeds_str = settings.custom_feeds if settings else "https://devops.com/feed/,\nhttps://thenewstack.io/feed/"
    youtube_api_key = settings.youtube_api_key if settings else None
    keywords = [kw.strip() for kw in keywords_str.split(",") if kw.strip()]
    general_feeds = [f.strip() for f in custom_feeds_str.split(",") if f.strip()]

    cache_key = (keywords_str, custom_feeds_str, bool(youtube_api_key))
    now_ts = time.time()
    if not force_refresh and _discover_cache["key"] == cache_key and _discover_cache["expires_at"] > now_ts:
        return _discover_cache["results"]

    results = []

    def fetch_medium(keyword):
        local_results = []
        try:
            feed_url = f"https://medium.com/feed/tag/{keyword.lower().replace(' ', '-')}"
            feed = feedparser.parse(feed_url)
            for entry in feed.entries[:60]:
                url = entry.link
                if url:
                    ts = get_rss_timestamp(entry)
                    local_results.append({
                        "title": entry.title,
                        "url": url,
                        "source": "Medium",
                        "keyword": keyword,
                        "summary": clean_html(entry.get('summary', '')),
                        "saved": False,
                        "timestamp": ts,
                        "date_str": datetime.datetime.fromtimestamp(ts).strftime("%b %d, %Y")
                    })
        except Exception as e:
            logger.warning("Medium fetch failed for %r: %s", keyword, e)
        return local_results

    def fetch_youtube(keyword):
        two_years_ago = time.time() - (2 * 365 * 24 * 3600)

        if youtube_api_key:
            api_results = fetch_youtube_via_api(keyword, youtube_api_key, two_years_ago)
            for r in api_results:
                r["keyword"] = keyword
            return api_results

        local_results = []
        try:
            # Search multiple variations to get more videos
            variations = [
                f"{keyword} tutorial", f"{keyword} crash course", f"{keyword} explained",
                f"{keyword} full course", f"{keyword} deep dive", keyword,
            ]
            for i, var in enumerate(variations):
                if i > 0:
                    # Small courtesy jitter between successive scrape requests
                    # for the same keyword, to avoid bursting YouTube.
                    time.sleep(random.uniform(0.5, 1.5))
                yt_results = SortedYoutubeSearch(var, max_results=40).to_dict()
                for yt in yt_results:
                    yt_url = f"https://youtube.com{yt['url_suffix']}"
                    if any(r['url'] == yt_url for r in local_results):
                        continue
                    if not _title_matches_keyword(yt.get('title', ''), keyword):
                        continue
                    ts = parse_yt_time(yt.get('publish_time'))
                    # Filter out videos older than 2 years (and unparseable dates, ts == 0)
                    if ts < two_years_ago:
                        continue
                    local_results.append({
                        "title": yt['title'],
                        "url": yt_url,
                        "source": "YouTube",
                        "keyword": keyword,
                        "thumbnail": yt.get('thumbnails', [])[0] if yt.get('thumbnails') else None,
                        "summary": "YouTube Video",
                        "saved": False,
                        "timestamp": ts,
                        "date_str": yt.get('publish_time', 'Recently')
                    })
        except Exception as e:
            logger.warning("YouTube scrape failed for %r: %s", keyword, e)
        return local_results

    def fetch_custom(g_feed):
        local_results = []
        try:
            feed = feedparser.parse(g_feed)
            for entry in feed.entries[:60]:
                ts = get_rss_timestamp(entry)
                domain_match = re.search(r'https?://(?:www\.)?([^/]+)', g_feed)
                source_name = domain_match.group(1) if domain_match else "Custom RSS"
                local_results.append({
                    "title": entry.title,
                    "url": entry.link,
                    "source": source_name,
                    "keyword": source_name,
                    "thumbnail": None,
                    "summary": clean_html(entry.get('summary', '')),
                    "saved": False,
                    "timestamp": ts,
                    "date_str": datetime.datetime.fromtimestamp(ts).strftime("%b %d, %Y")
                })
        except Exception as e:
            logger.warning("Custom feed fetch failed for %r: %s", g_feed, e)
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
                except Exception as e:
                    logger.warning("Discover task failed: %s", e)
    except Exception as e:
        logger.error("Discover error: %s", e)

    # De-dupe across keywords/sources (the same video/article can surface
    # under multiple search terms) before sorting.
    seen_urls = set()
    deduped = []
    for item in results:
        if item["url"] in seen_urls:
            continue
        seen_urls.add(item["url"])
        deduped.append(item)

    # Sort results from newest to oldest
    deduped.sort(key=lambda x: x.get('timestamp', 0), reverse=True)

    # Collapse near-duplicate coverage of the same story across sources.
    deduped = _cluster_near_duplicates(deduped)

    _discover_cache["key"] = cache_key
    _discover_cache["expires_at"] = time.time() + _DISCOVER_CACHE_TTL_SECONDS
    _discover_cache["results"] = deduped

    return deduped

def _extract_cve_severity(cve_item: dict) -> str:
    metrics = cve_item.get("metrics", {})
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        entries = metrics.get(key)
        if entries:
            data = entries[0].get("cvssData", {})
            severity = data.get("baseSeverity") or entries[0].get("baseSeverity")
            if severity:
                return severity
    return "UNKNOWN"

def fetch_and_store_cves(db, keywords, days_back: int = 14, results_per_keyword: int = 10):
    """Pulls recently-published CVEs matching the configured keywords from
    the NVD Data API v2.0 (no API key required, rate-limited to ~5 req/30s)
    and upserts them into the `cves` table."""
    from models import CVE

    now = datetime.datetime.now(datetime.timezone.utc)
    start = now - datetime.timedelta(days=days_back)
    added = 0

    for keyword in keywords:
        try:
            resp = requests.get(
                "https://services.nvd.nist.gov/rest/json/cves/2.0",
                params={
                    "keywordSearch": keyword,
                    "pubStartDate": start.strftime("%Y-%m-%dT%H:%M:%S.000"),
                    "pubEndDate": now.strftime("%Y-%m-%dT%H:%M:%S.000"),
                    "resultsPerPage": results_per_keyword,
                },
                timeout=15,
            )
            resp.raise_for_status()
            for wrapper in resp.json().get("vulnerabilities", []):
                cve_item = wrapper.get("cve", {})
                cve_id = cve_item.get("id")
                if not cve_id:
                    continue
                if db.query(CVE).filter(CVE.cve_id == cve_id).first():
                    continue
                descriptions = cve_item.get("descriptions", [])
                description = next((d["value"] for d in descriptions if d.get("lang") == "en"), "")
                db.add(CVE(
                    cve_id=cve_id,
                    description=description,
                    severity=_extract_cve_severity(cve_item),
                    status="new",
                ))
                added += 1
            db.commit()
            # Stay well under NVD's ~5 requests / 30s unauthenticated rate limit.
            time.sleep(6)
        except Exception as e:
            logger.warning("CVE fetch failed for %r: %s", keyword, e)

    return added

def find_learning_resources(topic: str, max_results: int = 3) -> list:
    """Web-searches for resources to actually learn a roadmap step from
    (docs, tutorials, guides) — a generated roadmap that just lists step
    titles with nothing to click on isn't much more useful than the
    title alone. Uses DDGS (free, no API key) rather than the heavier
    YouTube-scrape-with-retries path used by /discover, since this needs
    to stay fast enough to run inline for every step of a freshly
    generated goal."""
    try:
        results = DDGS().text(f"{topic} tutorial guide", max_results=max_results)
        return [
            {"title": r.get("title", topic), "url": r.get("href"), "source": "Web"}
            for r in results if r.get("href")
        ]
    except Exception as e:
        logger.warning("Resource search failed for %r: %s", topic, e)
        return []
