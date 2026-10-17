import uuid
from pydantic import BaseModel, ConfigDict
from datetime import datetime

# Base schema with shared fields
class ExerciseBase(BaseModel):
    name: str
    target_muscle_group: str
    default_equipment: str | None = None

# Schema for creating an exercise (POST /exercises)
# Client can optionally supply its own UUIDv4 for offline creation
class ExerciseCreate(ExerciseBase):
    id: uuid.UUID | None = None

# Schema for API responses (GET /exercises, POST /exercises)
class ExerciseResponse(ExerciseBase):
    id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)

class SetEntryBase(BaseModel):
    set_number: int
    set_type: str = "normal"
    weight: float
    reps: int
    rir: int | None = None
    completed: bool = False
    notes: str | None = None

# Sync DTO: client generates and supplies the UUIDv4
class SetEntrySync(SetEntryBase):
    id: uuid.UUID

# Response DTO: returns the set along with its parent log ID
class SetEntryResponse(SetEntryBase):
    id: uuid.UUID
    exercise_log_id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)


class ExerciseLogBase(BaseModel):
    exercise_id: uuid.UUID
    order_index: int
    notes: str | None = None
    exercise_name: str | None = None

# Sync DTO: client supplies UUID and nested sets
class ExerciseLogSync(ExerciseLogBase):
    id: uuid.UUID
    sets: list[SetEntrySync] = []

# Response DTO: returns log, session ID, and nested set responses
class ExerciseLogResponse(ExerciseLogBase):
    id: uuid.UUID
    workout_session_id: uuid.UUID
    sets: list[SetEntryResponse] = []

    model_config = ConfigDict(from_attributes=True)

class WorkoutSessionBase(BaseModel):
    name: str | None = None
    started_at: datetime
    completed_at: datetime | None = None
    session_notes: str | None = None
    routine_id: uuid.UUID | None = None

# Sync DTO: client supplies session UUID and nested logs
class WorkoutSessionSync(WorkoutSessionBase):
    id: uuid.UUID
    exercise_logs: list[ExerciseLogSync] = []

# Response DTO: returns full session with nested logs and sets
class WorkoutSessionResponse(WorkoutSessionBase):
    id: uuid.UUID
    exercise_logs: list[ExerciseLogResponse] = []

    model_config = ConfigDict(from_attributes=True)

# Top-level batch sync payload from client
class SyncPayload(BaseModel):
    sessions: list[WorkoutSessionSync] = []


# DTO for LLM 

class CoachExerciseFeedbackRequest(BaseModel):
    exercise_name: str
    target_muscle_group: str | None = None  # e.g., "Legs", "Chest"
    exercise_notes: str | None = None
    completed_sets: list[SetEntryBase] = []


class CoachExerciseFeedbackResponse(BaseModel):
    fatigue_level: str  # "low", "moderate", "high"
    suggested_weight: float | None = None
    suggested_reps: int | None = None
    feedback_message: str

class CoachWorkoutFeedbackRequest(BaseModel):
    workout_name: str | None = "Freeform Workout"
    session_notes: str | None = None
    duration_minutes: int | None = None
    exercises: list[CoachExerciseFeedbackRequest] = []

class CoachWorkoutFeedbackResponse(BaseModel):
    overall_assessment: str
    strain_rating: str  # "light", "moderate", "high", "excessive"
    total_volume_lbs: float = 0.0  # Sum of (weight * reps) across working sets
    target_muscle_groups: list[str] = []  # e.g., ["Chest", "Shoulders", "Triceps"]
    highlights: list[str] = []
    recovery_recommendations: str

