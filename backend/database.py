from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from config import settings

# If using psycopg2 with PostgreSQL, the URL might start with postgres:// or postgresql://
if settings.database_url.startswith("postgres://"):
    # SQLAlchemy 1.4+ requires postgresql://
    settings.database_url = settings.database_url.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
