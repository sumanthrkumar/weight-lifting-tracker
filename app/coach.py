import os
from google import genai
from google.genai import types
from fastapi import HTTPException, status
from app import schemas

def get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GEMINI_API_KEY is not set in the environment."
        )
    return genai.Client(api_key=api_key)

def generate_exercise_feedback(payload: schemas.CoachExerciseFeedbackRequest) -> schemas.CoachExerciseFeedbackResponse:
    client = get_client()

    system_instruction = (
        "You are an elite strength and conditioning coach and sports biomechanist. "
        "Analyze the lifter's completed sets, target muscle group, Reps in Reserve (RIR), and subjective notes for this exercise. "
        "Apply progressive overload and fatigue management principles. "
        "Prescribe concrete, specific targets for their next set (weight and reps) or recommend stopping if fatigue is excessive. "
        "Provide a direct, punchy 1-2 sentence coaching tip addressing their form, subjective notes, or tempo."
    )

    # Format completed sets into prompt context
    sets_summary = ""
    for s in payload.completed_sets:
        rir = f", RIR: {s.rir}" if s.rir is not None else ""
        note = f", Note: \"{s.notes}\"" if s.notes else ""
        sets_summary += f"- Set {s.set_number}: {s.weight} lbs x {s.reps} reps{rir}{note}\n"

    prompt = (
        f"Exercise: {payload.exercise_name}\n"
        f"Target Muscle Group: {payload.target_muscle_group or 'Not specified'}\n"
        f"Exercise Notes: {payload.exercise_notes or 'None'}\n\n"
        f"Completed Sets:\n{sets_summary or 'No sets logged yet.'}\n\n"
        "Evaluate the lifter's fatigue, suggest next set weight/reps, and give a concise coaching cue."
    )

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_schema=schemas.CoachExerciseFeedbackResponse,
            temperature=0.3,
        ),
    )
    return response.parsed


def generate_workout_feedback(payload: schemas.CoachWorkoutFeedbackRequest) -> schemas.CoachWorkoutFeedbackResponse:
    client = get_client()

    system_instruction = (
        "You are an elite strength and conditioning head coach and exercise physiologist. "
        "Evaluate the user's completed workout session holistically. "
        "Analyze training volume, exercise sequencing, muscle group distribution, fatigue accumulation, and subjective notes. "
        "Calculate or verify total volume in pounds (sum of weight * reps across completed sets). "
        "Assign an objective strain rating (light, moderate, high, excessive), highlight standout achievements, "
        "and provide actionable recovery, hydration, and nutritional guidance tailored to this session."
    )

    # Format the nested exercises and sets
    workout_breakdown = ""
    for exercise in payload.exercises:
        sets_lines = []
        for s in exercise.completed_sets:
            rir_str = f", RIR: {s.rir}" if s.rir is not None else ""
            note_str = f" ({s.notes})" if s.notes else ""
            sets_lines.append(f"    - Set {s.set_number}: {s.weight} lbs x {s.reps} reps{rir_str}{note_str}")

        sets_formatted = "\n".join(sets_lines) if sets_lines else "    - No sets logged"
        workout_breakdown += (
            f"Exercise: {exercise.exercise_name} (Target: {exercise.target_muscle_group or 'Unspecified'})\n"
            f"Exercise Notes: {exercise.exercise_notes or 'None'}\n"
            f"Sets:\n{sets_formatted}\n\n"
        )

    prompt = (
        f"Workout Name: {payload.workout_name or 'Workout'}\n"
        f"Duration: {payload.duration_minutes or 'Not tracked'} minutes\n"
        f"Session Notes: {payload.session_notes or 'None'}\n\n"
        f"Exercise Breakdown:\n{workout_breakdown or 'No exercises recorded.'}\n"
        "Generate a complete workout assessment, calculate total volume, extract unique target muscle groups, "
        "identify key highlights, and provide recovery recommendations."
    )

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_schema=schemas.CoachWorkoutFeedbackResponse,
            temperature=0.3,
        ),
    )
    return response.parsed