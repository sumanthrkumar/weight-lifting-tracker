# Project: Offline-First Weightlifting Tracker

## Stack & Target Environment
- Backend: Python (FastAPI, SQLAlchemy, Pydantic, Uvicorn)
- Persistence: SQLite with Write-Ahead Logging (WAL) enabled
- Ingress: Private mesh network / tunnel (e.g., Tailscale or Cloudflare)
- Containerization: Docker (mounts stored inside native POSIX / WSL2 Linux filesystem)

## Architecture & Sync Model
- Offline-First: Client (PWA / browser) writes to local storage first, then pushes to server via background sync.
- Client-Generated UUIDs: Client generates UUIDv4 for all primary keys (sessions, exercises, sets) to allow offline creation without ID collisions.
- Idempotent Ingestion: Server endpoints accept batch sync payloads and use upserts (insert or ignore / update on conflict) based on UUIDs.

## Relational Schema
- exercises:
  - id: UUID (PK)
  - name: VARCHAR (unique, indexed)
  - target_muscle_group: VARCHAR
  - default_equipment: VARCHAR (nullable)

- workout_sessions:
  - id: UUID (PK)
  - name: VARCHAR (nullable)
  - started_at: TIMESTAMP
  - completed_at: TIMESTAMP (nullable)
  - session_notes: TEXT (nullable)
  - routine_id: UUID (nullable, reserved for future routine engine)

- exercise_logs:
  - id: UUID (PK)
  - workout_session_id: UUID (FK -> workout_sessions.id, ON DELETE CASCADE)
  - exercise_id: UUID (FK -> exercises.id)
  - order_index: INT
  - notes: TEXT (nullable)

- set_entries:
  - id: UUID (PK)
  - exercise_log_id: UUID (FK -> exercise_logs.id, ON DELETE CASCADE)
  - set_number: INT
  - set_type: VARCHAR (warmup, normal, drop, failure)
  - weight: FLOAT
  - reps: INT
  - rir: INT (nullable)
  - completed: BOOLEAN
  - notes: TEXT (nullable)