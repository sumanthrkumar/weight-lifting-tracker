# Project: Offline-First Weightlifting Tracker

## Stack & Target Environment
- Backend: Python (FastAPI, SQLAlchemy, Pydantic, Uvicorn)
- Persistence: SQLite with Write-Ahead Logging (WAL) enabled
- Ingress: Private mesh network (Tailscale) or permanent static HTTPS domain. NEVER use temporary or rotating quick tunnels.
- Containerization: Docker (direct physical host bind mount to ./data/prod for permanent persistence)

## Mandatory Constraints & Rules (NEVER VIOLATE)
1. NEVER Suggest Ephemeral Storage: Any proposed deployment, cloud platform, or container MUST have verified, persistent disk storage. Never recommend free-tier cloud platforms (e.g., Render Web Services) that wipe local databases upon instance sleep or deployment restarts. Databases must use physical host bind mounts (e.g., `./data/prod/`) so data survives container deletion and rebuilding.
2. NEVER Suggest Temporary or Rotating URLs for PWAs: For web apps utilizing PWA Home Screen installation, Service Workers, or IndexedDB, never propose quick tunnels or dynamic domains (such as Cloudflare `trycloudflare.com` quick tunnels or temporary ngrok URLs). Rotating URLs break PWA shortcuts, force re-downloading/re-installing, and strand IndexedDB data on the old origin. Only recommend permanent, fixed domain names (e.g., Tailscale permanent MagicDNS/IP or permanent static domains).
3. Strict Production & Development Separation: Production database (`data/prod/weight_tracker_prod.db` on port 8000) is reserved exclusively for the user's phone. Development and testing MUST run on separate ports (port 8001) targeting `data/dev/weight_tracker_dev.db`. Never run test scripts, curl mutations, or schema experiments against the production database or port 8000.

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