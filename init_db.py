from sqlalchemy import inspect, select
from app.database import Base, engine, SessionLocal
import app.models as models

DEFAULT_EXERCISES = [
    {"name": "Barbell Bench Press", "target_muscle_group": "Chest", "default_equipment": "Barbell"},
    {"name": "Incline Dumbbell Press", "target_muscle_group": "Chest", "default_equipment": "Dumbbell"},
    {"name": "Barbell Squat", "target_muscle_group": "Quads", "default_equipment": "Barbell"},
    {"name": "Romanian Deadlift", "target_muscle_group": "Hamstrings", "default_equipment": "Barbell"},
    {"name": "Barbell Bent-Over Row", "target_muscle_group": "Back", "default_equipment": "Barbell"},
    {"name": "Lat Pulldown", "target_muscle_group": "Back", "default_equipment": "Cable"},
    {"name": "Overhead Dumbbell Press", "target_muscle_group": "Shoulders", "default_equipment": "Dumbbell"},
    {"name": "Lateral Raise", "target_muscle_group": "Shoulders", "default_equipment": "Dumbbell"},
    {"name": "Dumbbell Bicep Curl", "target_muscle_group": "Biceps", "default_equipment": "Dumbbell"},
    {"name": "Cable Tricep Pushdown", "target_muscle_group": "Triceps", "default_equipment": "Cable"},
]

def init_database():
    print("Creating all tables in SQLite...")
    Base.metadata.create_all(bind = engine)
    inspector = inspect(engine)

    table_names = inspector.get_table_names()
    print(f"Tables present: {table_names}")

    with SessionLocal() as db:
        existing = db.scalar(select(models.Exercise).limit(1))
        if existing is None:
            print("Seeding baseline exercise catalog...")
            for item in DEFAULT_EXERCISES:
                exercise = models.Exercise(
                    name = item["name"],
                    target_muscle_group = item["target_muscle_group"],
                    default_equipment = item["default_equipment"]
                )
                db.add(exercise)
            db.commit()
            print("Baseline exercise catalog seeded successfully.")

if __name__ == "__main__":
    init_database()
