import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlite3 import Connection

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./weight_tracker.db")

# Create the engine
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)

# SQLite PRAGMA hook for WAL mode and Foreign Keys
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection: Connection, connection_record):
    # Low-level DB-API cursor (similar to a raw JDBC java.sql.Connection cursor)
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
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
        