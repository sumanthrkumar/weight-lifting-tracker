from sqlalchemy import inspect, select
from app.database import Base, engine, SessionLocal, APP_ENV, DATABASE_URL
import app.models as models

DEFAULT_EXERCISES = [
    # Chest
    {"name": "Barbell Bench Press", "target_muscle_group": "Chest", "default_equipment": "Barbell"},
    {"name": "Incline Barbell Bench Press", "target_muscle_group": "Chest", "default_equipment": "Barbell"},
    {"name": "Decline Barbell Bench Press", "target_muscle_group": "Chest", "default_equipment": "Barbell"},
    {"name": "Dumbbell Bench Press", "target_muscle_group": "Chest", "default_equipment": "Dumbbell"},
    {"name": "Incline Dumbbell Press", "target_muscle_group": "Chest", "default_equipment": "Dumbbell"},
    {"name": "Dumbbell Chest Fly", "target_muscle_group": "Chest", "default_equipment": "Dumbbell"},
    {"name": "Cable Crossover / Chest Fly", "target_muscle_group": "Chest", "default_equipment": "Cable"},
    {"name": "Chest Press Machine", "target_muscle_group": "Chest", "default_equipment": "Machine"},
    {"name": "Pec Deck Machine", "target_muscle_group": "Chest", "default_equipment": "Machine"},
    {"name": "Dips (Chest Focus)", "target_muscle_group": "Chest", "default_equipment": "Bodyweight"},
    {"name": "Push-Up", "target_muscle_group": "Chest", "default_equipment": "Bodyweight"},

    # Back
    {"name": "Barbell Deadlift", "target_muscle_group": "Back", "default_equipment": "Barbell"},
    {"name": "Barbell Bent-Over Row", "target_muscle_group": "Back", "default_equipment": "Barbell"},
    {"name": "Single-Arm Dumbbell Row", "target_muscle_group": "Back", "default_equipment": "Dumbbell"},
    {"name": "Lat Pulldown", "target_muscle_group": "Back", "default_equipment": "Cable"},
    {"name": "Seated Cable Row", "target_muscle_group": "Back", "default_equipment": "Cable"},
    {"name": "Pull-Up", "target_muscle_group": "Back", "default_equipment": "Bodyweight"},
    {"name": "Chin-Up", "target_muscle_group": "Back", "default_equipment": "Bodyweight"},
    {"name": "T-Bar Row", "target_muscle_group": "Back", "default_equipment": "Barbell"},
    {"name": "Chest-Supported Row", "target_muscle_group": "Back", "default_equipment": "Machine"},
    {"name": "Straight-Arm Cable Pulldown", "target_muscle_group": "Back", "default_equipment": "Cable"},
    {"name": "Back Extension / Hyperextension", "target_muscle_group": "Back", "default_equipment": "Bodyweight"},

    # Shoulders
    {"name": "Overhead Barbell Press", "target_muscle_group": "Shoulders", "default_equipment": "Barbell"},
    {"name": "Overhead Dumbbell Press", "target_muscle_group": "Shoulders", "default_equipment": "Dumbbell"},
    {"name": "Arnold Press", "target_muscle_group": "Shoulders", "default_equipment": "Dumbbell"},
    {"name": "Dumbbell Lateral Raise", "target_muscle_group": "Shoulders", "default_equipment": "Dumbbell"},
    {"name": "Cable Lateral Raise", "target_muscle_group": "Shoulders", "default_equipment": "Cable"},
    {"name": "Dumbbell Front Raise", "target_muscle_group": "Shoulders", "default_equipment": "Dumbbell"},
    {"name": "Face Pull", "target_muscle_group": "Shoulders", "default_equipment": "Cable"},
    {"name": "Rear Delt Fly (Dumbbell)", "target_muscle_group": "Shoulders", "default_equipment": "Dumbbell"},
    {"name": "Rear Delt Machine (Reverse Pec Deck)", "target_muscle_group": "Shoulders", "default_equipment": "Machine"},
    {"name": "Barbell Shrug", "target_muscle_group": "Shoulders", "default_equipment": "Barbell"},
    {"name": "Dumbbell Shrug", "target_muscle_group": "Shoulders", "default_equipment": "Dumbbell"},
    {"name": "Upright Row", "target_muscle_group": "Shoulders", "default_equipment": "Barbell"},

    # Biceps
    {"name": "Barbell Bicep Curl", "target_muscle_group": "Biceps", "default_equipment": "Barbell"},
    {"name": "EZ-Bar Curl", "target_muscle_group": "Biceps", "default_equipment": "Barbell"},
    {"name": "Dumbbell Bicep Curl", "target_muscle_group": "Biceps", "default_equipment": "Dumbbell"},
    {"name": "Dumbbell Hammer Curl", "target_muscle_group": "Biceps", "default_equipment": "Dumbbell"},
    {"name": "Incline Dumbbell Curl", "target_muscle_group": "Biceps", "default_equipment": "Dumbbell"},
    {"name": "Preacher Curl", "target_muscle_group": "Biceps", "default_equipment": "Barbell"},
    {"name": "Cable Bicep Curl", "target_muscle_group": "Biceps", "default_equipment": "Cable"},
    {"name": "Concentration Curl", "target_muscle_group": "Biceps", "default_equipment": "Dumbbell"},

    # Triceps
    {"name": "Cable Tricep Pushdown", "target_muscle_group": "Triceps", "default_equipment": "Cable"},
    {"name": "Cable Rope Overhead Tricep Extension", "target_muscle_group": "Triceps", "default_equipment": "Cable"},
    {"name": "Skull Crusher (Lying Triceps Extension)", "target_muscle_group": "Triceps", "default_equipment": "Barbell"},
    {"name": "Overhead Dumbbell Tricep Extension", "target_muscle_group": "Triceps", "default_equipment": "Dumbbell"},
    {"name": "Close-Grip Barbell Bench Press", "target_muscle_group": "Triceps", "default_equipment": "Barbell"},
    {"name": "Tricep Dips (Bench / Parallel Bars)", "target_muscle_group": "Triceps", "default_equipment": "Bodyweight"},

    # Quads
    {"name": "Barbell Squat", "target_muscle_group": "Quads", "default_equipment": "Barbell"},
    {"name": "Barbell Front Squat", "target_muscle_group": "Quads", "default_equipment": "Barbell"},
    {"name": "Leg Press", "target_muscle_group": "Quads", "default_equipment": "Machine"},
    {"name": "Hack Squat", "target_muscle_group": "Quads", "default_equipment": "Machine"},
    {"name": "Bulgarian Split Squat", "target_muscle_group": "Quads", "default_equipment": "Dumbbell"},
    {"name": "Walking Dumbbell Lunge", "target_muscle_group": "Quads", "default_equipment": "Dumbbell"},
    {"name": "Leg Extension", "target_muscle_group": "Quads", "default_equipment": "Machine"},
    {"name": "Goblet Squat", "target_muscle_group": "Quads", "default_equipment": "Dumbbell"},

    # Hamstrings
    {"name": "Romanian Deadlift", "target_muscle_group": "Hamstrings", "default_equipment": "Barbell"},
    {"name": "Dumbbell Romanian Deadlift", "target_muscle_group": "Hamstrings", "default_equipment": "Dumbbell"},
    {"name": "Lying Leg Curl", "target_muscle_group": "Hamstrings", "default_equipment": "Machine"},
    {"name": "Seated Leg Curl", "target_muscle_group": "Hamstrings", "default_equipment": "Machine"},
    {"name": "Good Morning", "target_muscle_group": "Hamstrings", "default_equipment": "Barbell"},

    # Glutes
    {"name": "Barbell Hip Thrust", "target_muscle_group": "Glutes", "default_equipment": "Barbell"},
    {"name": "Dumbbell Glute Bridge", "target_muscle_group": "Glutes", "default_equipment": "Dumbbell"},
    {"name": "Cable Kickback", "target_muscle_group": "Glutes", "default_equipment": "Cable"},
    {"name": "Cable Pull-Through", "target_muscle_group": "Glutes", "default_equipment": "Cable"},
    {"name": "Seated Hip Abduction Machine", "target_muscle_group": "Glutes", "default_equipment": "Machine"},

    # Calves
    {"name": "Standing Calf Raise", "target_muscle_group": "Calves", "default_equipment": "Machine"},
    {"name": "Seated Calf Raise", "target_muscle_group": "Calves", "default_equipment": "Machine"},

    # Core
    {"name": "Hanging Leg Raise", "target_muscle_group": "Core", "default_equipment": "Bodyweight"},
    {"name": "Cable Crunch", "target_muscle_group": "Core", "default_equipment": "Cable"},
    {"name": "Ab Wheel Rollout", "target_muscle_group": "Core", "default_equipment": "Bodyweight"},
    {"name": "Plank", "target_muscle_group": "Core", "default_equipment": "Bodyweight"},
    {"name": "Russian Twist", "target_muscle_group": "Core", "default_equipment": "Bodyweight"}
]

def init_database():
    print(f"Connecting to database: {DATABASE_URL} (Environment: {APP_ENV})")
    print("Creating all tables in SQLite...")
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)

    table_names = inspector.get_table_names()
    print(f"Tables present: {table_names}")

    with SessionLocal() as db:
        existing_exercises = {e.name.lower(): e for e in db.scalars(select(models.Exercise)).all()}
        added_count = 0
        for item in DEFAULT_EXERCISES:
            if item["name"].lower() not in existing_exercises:
                exercise = models.Exercise(
                    name=item["name"],
                    target_muscle_group=item["target_muscle_group"],
                    default_equipment=item["default_equipment"]
                )
                db.add(exercise)
                added_count += 1
        db.commit()
        if added_count > 0:
            print(f"Seeded {added_count} exercises into baseline catalog.", flush=True)
        else:
            print(f"Baseline catalog already contains {len(existing_exercises)} exercises.", flush=True)

if __name__ == "__main__":
    init_database()
