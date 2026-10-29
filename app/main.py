import uuid
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.responses import RedirectResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app import models, schemas, coach

app = FastAPI(title="Weightlifting Tracker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Service Worker endpoints with root scope authorization
@app.api_route("/sw.js", methods=["GET", "HEAD"], include_in_schema=False)
def get_root_service_worker():
    return FileResponse(
        "client/sw.js",
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-cache"}
    )

@app.api_route("/app/sw.js", methods=["GET", "HEAD"], include_in_schema=False)
def get_app_service_worker():
    return FileResponse(
        "client/sw.js",
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-cache"}
    )

# GET /server-info - Return current environment and database isolation details
@app.get("/server-info")
def get_server_info():
    from app.database import APP_ENV, DATABASE_URL
    db_target = DATABASE_URL.split("///")[-1] if "///" in DATABASE_URL else DATABASE_URL
    return {
        "status": "healthy",
        "environment": APP_ENV,
        "database": db_target
    }

# GET / - Redirect to Mobile PWA Client
@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
def root_redirect():
    return RedirectResponse(url="/app/")

# GET /exercises - Return all exercises ordered by name
@app.get("/exercises", response_model=list[schemas.ExerciseResponse])
def get_exercises(db: Session = Depends(get_db)):
    stmt = select(models.Exercise).order_by(models.Exercise.name)
    exercises = db.scalars(stmt).all()
    return exercises

# POST /exercises - Create a new exercise
@app.post("/exercises", response_model=schemas.ExerciseResponse, status_code=status.HTTP_201_CREATED)
def create_exercise(exercise_in: schemas.ExerciseCreate, db: Session = Depends(get_db)):
    # Check if exercise with this name already exists
    existing = db.scalars(
        select(models.Exercise).where(models.Exercise.name == exercise_in.name)
    ).first()
    if existing:
        raise HTTPException(
            status_code = status.HTTP_409_CONFLICT,
            detail = f"Exercise with name '{exercise_in.name}' already exists"
        )

    new_exercise = models.Exercise(
        id = exercise_in.id or uuid.uuid4(),
        name = exercise_in.name,
        target_muscle_group = exercise_in.target_muscle_group,
        default_equipment = exercise_in.default_equipment
    )

    db.add(new_exercise)
    db.commit()
    db.refresh(new_exercise)
    return new_exercise

# PUT /exercises/{exercise_id} - Update an existing exercise
@app.put("/exercises/{exercise_id}", response_model=schemas.ExerciseResponse)
def update_exercise(exercise_id: uuid.UUID, exercise_in: schemas.ExerciseBase, db: Session = Depends(get_db)):
    db_ex = db.get(models.Exercise, exercise_id)
    if not db_ex:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Exercise not found"
        )

    # Check for name uniqueness if the name was changed
    if exercise_in.name != db_ex.name:
        existing = db.scalars(
            select(models.Exercise).where(models.Exercise.name == exercise_in.name)
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Exercise with name '{exercise_in.name}' already exists"
            )

    db_ex.name = exercise_in.name
    db_ex.target_muscle_group = exercise_in.target_muscle_group
    db_ex.default_equipment = exercise_in.default_equipment

    db.commit()
    db.refresh(db_ex)
    return db_ex

# DELETE /exercises/{exercise_id} - Delete an exercise if not referenced by logs
@app.delete("/exercises/{exercise_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exercise(exercise_id: uuid.UUID, db: Session = Depends(get_db)):
    db_ex = db.get(models.Exercise, exercise_id)
    if not db_ex:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Exercise not found"
        )

    # Prevent deleting if logs reference this exercise
    has_logs = db.scalars(
        select(models.ExerciseLog).where(models.ExerciseLog.exercise_id == exercise_id)
    ).first()
    if has_logs:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete exercise with existing workout logs"
        )

    db.delete(db_ex)
    db.commit()


@app.post("/sync", status_code=status.HTTP_200_OK)
def sync_workouts(payload: schemas.SyncPayload, db: Session = Depends(get_db)):
    synced_session_count = 0

    for session_data in payload.sessions:
        # Upsert WorkoutSession
        db_session = db.get(models.WorkoutSession, session_data.id)

        # No session - so create 
        if not db_session:
            db_session = models.WorkoutSession(
                id = session_data.id,
                name = session_data.name,
                started_at = session_data.started_at,
                completed_at = session_data.completed_at,
                session_notes = session_data.session_notes,
                routine_id = session_data.routine_id
            )
            db.add(db_session)
        else:
            # Session already exists - so update
            db_session.name = session_data.name
            db_session.started_at = session_data.started_at
            db_session.completed_at = session_data.completed_at
            db_session.session_notes = session_data.session_notes
            db_session.routine_id = session_data.routine_id

        # Upsert ExerciseLogs
        for log_data in session_data.exercise_logs:
            # Ensure exercise exists before creating log to satisfy foreign key constraint
            db_ex = db.get(models.Exercise, log_data.exercise_id)
            if not db_ex:
                # If exercise not found by ID, look up by name if provided
                if log_data.exercise_name:
                    existing_by_name = db.scalars(
                        select(models.Exercise).where(models.Exercise.name == log_data.exercise_name)
                    ).first()
                    if existing_by_name:
                        db_ex = existing_by_name
                        log_data.exercise_id = existing_by_name.id

                if not db_ex:
                    db_ex = models.Exercise(
                        id = log_data.exercise_id,
                        name = log_data.exercise_name or f"Exercise ({str(log_data.exercise_id)[:8]})",
                        target_muscle_group = log_data.target_muscle_group or "Other",
                        default_equipment = "Other"
                    )
                    db.add(db_ex)
                    db.flush()

            db_log = db.get(models.ExerciseLog, log_data.id)
            if not db_log:
                db_log = models.ExerciseLog(
                    id = log_data.id,
                    workout_session_id = session_data.id,
                    exercise_id = log_data.exercise_id,
                    order_index = log_data.order_index,
                    notes = log_data.notes
                )
                db.add(db_log)
            else:
                db_log.exercise_id = log_data.exercise_id
                db_log.order_index = log_data.order_index
                db_log.notes = log_data.notes

            # 3. Upsert SetEntries
            for set_data in log_data.sets:
                db_set = db.get(models.SetEntry, set_data.id)
                if not db_set:
                    db_set = models.SetEntry(
                        id = set_data.id, 
                        exercise_log_id = log_data.id, 
                        set_number = set_data.set_number,
                        set_type = set_data.set_type,
                        weight = set_data.weight, 
                        reps = set_data.reps,
                        rir = set_data.rir, 
                        completed = set_data.completed, 
                        notes = set_data.notes
                    )
                    db.add(db_set)
                else:
                    db_set.set_number = set_data.set_number
                    db_set.set_type = set_data.set_type
                    db_set.weight = set_data.weight
                    db_set.reps = set_data.reps
                    db_set.rir = set_data.rir
                    db_set.completed = set_data.completed
                    db_set.notes = set_data.notes

        synced_session_count += 1

    # Atomic commit for the entire batch
    db.commit()

    return {
        "status": "success",
        "synced_sessions": synced_session_count
    }

# GET /sessions - Retrieve all sessions with nested logs and sets
@app.get("/sessions", response_model=list[schemas.WorkoutSessionResponse])
def get_sessions(db: Session = Depends(get_db)):
    stmt = (
        select(models.WorkoutSession)
        .options(
            selectinload(models.WorkoutSession.exercise_logs)
            .selectinload(models.ExerciseLog.sets),
            selectinload(models.WorkoutSession.exercise_logs)
            .selectinload(models.ExerciseLog.exercise)
        )
        .order_by(models.WorkoutSession.started_at.desc())
    )

    sessions = db.scalars(stmt).all()
    return sessions

# GET /sessions/{session_id} - Retrieve a single session by UUID
@app.get("/sessions/{session_id}", response_model=schemas.WorkoutSessionResponse)
def get_session(session_id: uuid.UUID, db: Session = Depends(get_db)):
    stmt = (
        select(models.WorkoutSession)
        .options(
            selectinload(models.WorkoutSession.exercise_logs)
            .selectinload(models.ExerciseLog.sets),
            selectinload(models.WorkoutSession.exercise_logs)
            .selectinload(models.ExerciseLog.exercise)
        )
        .where(models.WorkoutSession.id == session_id)
    )
    session = db.scalars(stmt).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workout session not found"
        )
    return session

# DELETE /sessions/{session_id} - Delete session (cascades to logs and sets)
@app.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: uuid.UUID, db: Session = Depends(get_db)):
    db_session = db.get(models.WorkoutSession, session_id)
    if not db_session:
        raise HTTPException(
            status_code = status.HTTP_404_NOT_FOUND,
            detail = "Workout session not found"
        )

    db.delete(db_session)
    db.commit()

# PATCH /sessions/{session_id} - Update session name or notes
@app.patch("/sessions/{session_id}", response_model=schemas.WorkoutSessionResponse)
def update_session(session_id: uuid.UUID, session_in: schemas.WorkoutSessionUpdate, db: Session = Depends(get_db)):
    stmt = (
        select(models.WorkoutSession)
        .options(
            selectinload(models.WorkoutSession.exercise_logs)
            .selectinload(models.ExerciseLog.sets),
            selectinload(models.WorkoutSession.exercise_logs)
            .selectinload(models.ExerciseLog.exercise)
        )
        .where(models.WorkoutSession.id == session_id)
    )
    db_session = db.scalars(stmt).first()
    if not db_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workout session not found"
        )
    if session_in.name is not None:
        db_session.name = session_in.name
    if session_in.session_notes is not None:
        db_session.session_notes = session_in.session_notes
    db.commit()
    db.refresh(db_session)
    return db_session

@app.post("/coach/exercise", response_model=schemas.CoachExerciseFeedbackResponse)
def coach_exercise_feedback(payload: schemas.CoachExerciseFeedbackRequest):
    print(f"[COACH REQ] {payload.exercise_name} ({payload.target_muscle_group}) sets={len(payload.completed_sets)}", flush=True)
    res = coach.generate_exercise_feedback(payload)
    print(f"[COACH RES] fatigue={res.fatigue_level} weight={res.suggested_weight} reps={res.suggested_reps} msg={res.feedback_message}", flush=True)
    return res

@app.post("/coach/workout", response_model=schemas.CoachWorkoutFeedbackResponse)
def coach_workout_feedback(payload: schemas.CoachWorkoutFeedbackRequest):
    print(f"[WORKOUT COACH REQ] {payload.workout_name} exercises={len(payload.exercises)}", flush=True)
    try:
        res = coach.generate_workout_feedback(payload)
        print(f"[WORKOUT COACH RES] strain={res.strain_rating} volume={res.total_volume_lbs}", flush=True)
        return res
    except Exception as e:
        print(f"[WORKOUT COACH ERROR] {e}", flush=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI Coach generation error: {str(e)}"
        )



# Serve Mobile PWA Client
import os
from fastapi.staticfiles import StaticFiles

if os.path.exists("client"):
    app.mount("/app", StaticFiles(directory="client", html=True), name="client")
