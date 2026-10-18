import uuid
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime

from app.database import Base

class Exercise(Base):
    __tablename__ = "exercises"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    target_muscle_group: Mapped[str] = mapped_column(String, nullable=False)
    default_equipment: Mapped[str | None] = mapped_column(String, nullable=True)

class WorkoutSession(Base):
    __tablename__ = "workout_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    session_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    routine_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)

    exercise_logs: Mapped[list["ExerciseLog"]] = relationship(
        back_populates="workout_session",
        cascade="all, delete-orphan"
    )

class ExerciseLog(Base):
    __tablename__ = "exercise_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    # Foreign key referencing workout_sessions.id with cascading delete
    workout_session_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("workout_sessions.id", ondelete="CASCADE"), nullable=False)

    # Foreign key referencing exercises.id
    exercise_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("exercises.id"), nullable=False)

    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    workout_session: Mapped["WorkoutSession"] = relationship(back_populates="exercise_logs")
    exercise: Mapped["Exercise"] = relationship()

    sets: Mapped[list["SetEntry"]] = relationship(back_populates="exercise_log", cascade="all, delete-orphan")

    @property
    def exercise_name(self) -> str:
        return self.exercise.name if self.exercise else "Exercise"

    @property
    def target_muscle_group(self) -> str:
        return self.exercise.target_muscle_group if self.exercise else "Other"

class SetEntry(Base):
    __tablename__ = "set_entries"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    # Foreign key referencing exercise_logs.id with cascade delete
    exercise_log_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("exercise_logs.id", ondelete="CASCADE"),
        nullable=False
    )

    set_number: Mapped[int] = mapped_column(Integer, nullable=False)
    # set_type: warmup, normal, drop, failure
    set_type: Mapped[str] = mapped_column(String, default="normal", nullable=False)
    weight: Mapped[float] = mapped_column(Float, nullable=False)
    reps: Mapped[int] = mapped_column(Integer, nullable=False)
    # Reps In Reserve
    rir: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


    # Relationship back to ExerciseLog
    exercise_log: Mapped["ExerciseLog"] = relationship(back_populates="sets")


