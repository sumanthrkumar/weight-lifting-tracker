import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlite3 import Connection

APP_ENV = os.getenv("APP_ENV", "development").lower()

def get_default_database_url() -> str:
    if APP_ENV == "production":
        return "sqlite:///./data/prod/weight_tracker_prod.db"
    return "sqlite:///./data/dev/weight_tracker_dev.db"

DATABASE_URL = os.getenv("DATABASE_URL") or get_default_database_url()

# Ensure the directory exists if targeting a local SQLite file
if DATABASE_URL.startswith("sqlite:///"):
    raw_path = DATABASE_URL.replace("sqlite:///", "")
    if not raw_path.startswith(":memory:"):
        db_dir = os.path.dirname(raw_path)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)

# Create the engine
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)

# SQLite PRAGMA hook for single-file durability and Foreign Keys
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection: Connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=DELETE")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

# Session factory (similar to Hibernate SessionFactory)
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# Declarative Base class
class Base(DeclarativeBase):
    pass

# Dependency injection generator for request lifecycle
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
        