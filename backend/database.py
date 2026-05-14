import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./jobs.db")

# SQLite needs check_same_thread=False because FastAPI runs handlers in a
# thread pool. This flag is harmless on Postgres (the arg is ignored).
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=_connect_args,
    # echo=True  ← uncomment to log every SQL statement during debugging
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency — yields a session and guarantees it closes."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables that don't yet exist.

    Caller (main.py startup) must import models before calling this so that
    SQLAlchemy's metadata registry is populated:

        import models          # registers Job with Base.metadata
        from database import init_db
        init_db()
    """
    Base.metadata.create_all(bind=engine)
