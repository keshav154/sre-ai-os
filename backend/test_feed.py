import sys
sys.path.append('.')
from collector import auto_discover

try:
    print("Testing auto_discover with feedparser...")
    count = auto_discover()
    print(f"Total Discovered: {count}")
    
    from database import get_db
    from models import Article
    db = next(get_db())
    articles = db.query(Article).all()
    print(f"Articles in DB: {len(articles)}")
except Exception as e:
    import traceback
    traceback.print_exc()
