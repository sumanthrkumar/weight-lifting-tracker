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
    return genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(
            timeout=60000,  # milliseconds (60 seconds)
            retry_options=types.HttpRetryOptions(attempts=2),
        ),
    )

def generate_deterministic_exercise_feedback(payload: schemas.CoachExerciseFeedbackRequest) -> schemas.CoachExerciseFeedbackResponse:
    if not payload.completed_sets:
        return schemas.CoachExerciseFeedbackResponse(
            fatigue_level="low",
            suggested_weight=None,
            suggested_reps=None,
            feedback_message=f"Ready to log your first set of {payload.exercise_name}. Focus on crisp warmups and locked bar path."
        )
    last_set = payload.completed_sets[-1]
    rir = last_set.rir if last_set.rir is not None else 2
    if rir <= 1:
        fatigue = "high"
        suggested_weight = last_set.weight
        suggested_reps = max(1, last_set.reps - 1)
        msg = f"Fatigue is elevating (RIR {rir}). Maintain {suggested_weight} lbs and target {suggested_reps} clean reps, or take an extra 60s rest."
    elif rir >= 3:
        fatigue = "low"
        suggested_weight = round((last_set.weight + 2.5) / 2.5) * 2.5
        suggested_reps = last_set.reps
        msg = f"Strong velocity and low fatigue (RIR {rir}). You have headroom to push to {suggested_weight} lbs for {suggested_reps} reps."
    else:
        fatigue = "moderate"
        suggested_weight = last_set.weight
        suggested_reps = last_set.reps
        msg = f"Solid working set intensity. Maintain {suggested_weight} lbs x {suggested_reps} reps for the next set."

    return schemas.CoachExerciseFeedbackResponse(
        fatigue_level=fatigue,
        suggested_weight=suggested_weight,
        suggested_reps=suggested_reps,
        feedback_message=msg
    )

def generate_exercise_feedback(payload: schemas.CoachExerciseFeedbackRequest) -> schemas.CoachExerciseFeedbackResponse:
    try:
        client = get_client()

        system_instruction = (
            "You are an elite strength and conditioning coach and sports biomechanist. "
            "Analyze the lifter's completed sets, target muscle group, Reps in Reserve (RIR), and subjective notes for this exercise. "
            "Apply progressive overload and fatigue management principles. "
            "Prescribe concrete, specific targets for their next set (weight and reps) or recommend stopping if fatigue is excessive. "
            "Provide a direct, punchy 1-2 sentence coaching tip addressing their form, subjective notes, or tempo."
        )

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
    except Exception as e:
        print(f"[EXERCISE COACH FALLBACK] {e}", flush=True)
        return generate_deterministic_exercise_feedback(payload)

def generate_deterministic_workout_feedback(payload: schemas.CoachWorkoutFeedbackRequest) -> schemas.CoachWorkoutFeedbackResponse:
    muscle_map: dict[str, float] = {}
    total_vol = 0.0
    progression_suggestions: list[schemas.ExerciseProgressionSuggestion] = []
    form_cues: list[schemas.ExerciseFormCue] = []
    highlights: list[str] = []

    for ex in payload.exercises:
        mg = ex.target_muscle_group or "Full Body"
        ex_vol = 0.0
        max_weight = 0.0
        best_set = None
        rirs: list[int] = []
        all_notes: list[str] = []
        if ex.exercise_notes:
            all_notes.append(ex.exercise_notes)

        for s in ex.completed_sets:
            vol = (s.weight or 0.0) * (s.reps or 0)
            ex_vol += vol
            total_vol += vol
            muscle_map[mg] = muscle_map.get(mg, 0.0) + vol
            if s.weight > max_weight:
                max_weight = s.weight
                best_set = s
            if s.rir is not None:
                rirs.append(s.rir)
            if s.notes:
                all_notes.append(s.notes)

        if best_set:
            avg_rir = sum(rirs) / len(rirs) if rirs else 2.0
            if avg_rir >= 2:
                increment = 5.0 if max_weight >= 100 else 2.5
                next_weight = round((max_weight + increment) / 2.5) * 2.5
                rec = f"Average RIR of {avg_rir:.1f} shows reserve capacity. Recommend progressing weight to {next_weight} lbs next workout for progressive overload."
            elif avg_rir == 0:
                next_weight = max_weight
                rec = f"Set reached technical failure (RIR 0). Maintain {next_weight} lbs next session and aim for 1-2 additional clean reps before increasing weight."
            else:
                next_weight = round((max_weight + 2.5) / 2.5) * 2.5
                rec = f"Solid training stimulus (RIR ~1). Consider a micro-progression to {next_weight} lbs or adding another set next workout."

            progression_suggestions.append(schemas.ExerciseProgressionSuggestion(
                exercise_name=ex.exercise_name,
                current_performance=f"{best_set.weight} lbs x {best_set.reps} reps (RIR {best_set.rir if best_set.rir is not None else 'N/A'})",
                suggested_weight=next_weight,
                suggested_reps=best_set.reps,
                suggested_sets=len(ex.completed_sets),
                recommendation=rec
            ))

        combined_notes = " ".join(all_notes).lower()
        if "flare" in combined_notes or "elbow" in combined_notes:
            form_cues.append(schemas.ExerciseFormCue(
                exercise_name=ex.exercise_name,
                form_cue="Tuck elbows to 45–60 degrees relative to your torso.",
                observation=f"Notes indicated elbow flare or joint stress on {ex.exercise_name}.",
                maintenance_tip="Pack your shoulder blades into your back pockets and actively pull the bar towards your chest to keep lats engaged."
            ))
        elif "back" in combined_notes or "spine" in combined_notes or "round" in combined_notes:
            form_cues.append(schemas.ExerciseFormCue(
                exercise_name=ex.exercise_name,
                form_cue="Brace intra-abdominal pressure (Valsalva) and maintain a rigid neutral spine.",
                observation=f"Notes indicated lumbar or spine fatigue on {ex.exercise_name}.",
                maintenance_tip="Hinge cleanly from the hips and lead with the chest; do not initiate movement by flexing lumbar vertebrae."
            ))
        elif "knee" in combined_notes or "cave" in combined_notes or "valgus" in combined_notes:
            form_cues.append(schemas.ExerciseFormCue(
                exercise_name=ex.exercise_name,
                form_cue="Drive knees outward over your 2nd and 3rd toes throughout the movement.",
                observation=f"Notes indicated knee collapse or uneven tracking on {ex.exercise_name}.",
                maintenance_tip="Maintain tripod foot contact (heel, big toe, pinky toe) and corkscrew feet into the floor."
            ))
        elif "heavy" in combined_notes or "struggle" in combined_notes or "slow" in combined_notes:
            form_cues.append(schemas.ExerciseFormCue(
                exercise_name=ex.exercise_name,
                form_cue="Maintain consistent bar path velocity through the sticking point.",
                observation=f"Lifter experienced significant load resistance on {ex.exercise_name}.",
                maintenance_tip="Commit to aggressive concentric drive while keeping core stability completely locked."
            ))
        elif ex.completed_sets:
            form_cues.append(schemas.ExerciseFormCue(
                exercise_name=ex.exercise_name,
                form_cue="Control the eccentric phase for 2-3 seconds to maximize mechanical tension.",
                observation=f"Key technical cue for {ex.exercise_name}.",
                maintenance_tip="Pause momentarily at the deepest stretch without relaxing active muscular contraction."
            ))

        if ex_vol > 0:
            highlights.append(f"{ex.exercise_name}: {round(ex_vol):,} lbs moved across {len(ex.completed_sets)} sets")

    muscle_group_volumes = [
        schemas.MuscleGroupVolume(muscle_group=k, volume_lbs=round(v, 1))
        for k, v in sorted(muscle_map.items(), key=lambda item: item[1], reverse=True)
    ]
    target_muscle_groups = list(muscle_map.keys())

    if total_vol < 4000:
        strain_rating = "light"
    elif total_vol < 12000:
        strain_rating = "moderate"
    elif total_vol < 22000:
        strain_rating = "high"
    else:
        strain_rating = "excessive"

    if payload.session_notes and payload.session_notes.strip():
        workout_notes_feedback = (
            f"Session Plan & Execution Review: You noted '{payload.session_notes.strip()}'. "
            f"Your session demonstrated targeted intent with {len(payload.exercises)} exercises logged and {round(total_vol):,} lbs of mechanical work. "
            f"Continuing to reflect on physical readiness and session objectives reinforces systematic strength development."
        )
    else:
        workout_notes_feedback = (
            "No workout notes were recorded for this session. "
            "Pro-tip: Jotting down your target focus, pre-workout energy, or planned RIR in the Workout Notes field "
            "enables the AI Coach to track mental readiness and adapt intensity recommendations."
        )

    overall_assessment = (
        f"Completed {len(payload.exercises)} exercises across {len(target_muscle_groups)} muscle groups "
        f"generating {round(total_vol):,} lbs of total mechanical work. Training strain rated as {strain_rating}."
    )

    recovery_recommendations = (
        f"Hydrate with 500-750ml water enriched with electrolytes. "
        f"Target 30-40g high-quality protein within 2 hours to initiate muscle protein synthesis for {', '.join(target_muscle_groups) or 'worked muscles'}. "
        f"Allow 48 hours before taxing these primary muscle groups with heavy compound loading again."
    )

    return schemas.CoachWorkoutFeedbackResponse(
        overall_assessment=overall_assessment,
        strain_rating=strain_rating,
        total_volume_lbs=round(total_vol, 1),
        target_muscle_groups=target_muscle_groups,
        muscle_group_volumes=muscle_group_volumes,
        workout_notes_feedback=workout_notes_feedback,
        progression_suggestions=progression_suggestions,
        form_cues=form_cues,
        highlights=highlights,
        recovery_recommendations=recovery_recommendations
    )

def generate_workout_feedback(payload: schemas.CoachWorkoutFeedbackRequest) -> schemas.CoachWorkoutFeedbackResponse:
    try:
        client = get_client()

        system_instruction = (
            "You are an elite strength and conditioning head coach and exercise physiologist. "
            "Evaluate the user's completed or in-progress workout session comprehensively. "
            "Your responsibilities: "
            "1. Calculate mechanical volume in pounds (sum of weight * reps across completed sets) and break down total volume by each distinct muscle group in muscle_group_volumes. "
            "2. If workout-level notes or plans are present in session_notes, evaluate them in workout_notes_feedback (addressing their training goals, energy, or plans). If not provided, suggest an intentional target for next time. "
            "3. For each exercise performed, analyze the lifter's weights, reps, and Reps In Reserve (RIR). In progression_suggestions, recommend whether to increase weight, sets, or reps next time. Prescribe concrete suggested weights (in lbs) and reps. "
            "4. Carefully inspect all exercise notes and set notes for mentions of form breakdown, instability, or perceived heaviness. In form_cues, identify any issues, supply a high-impact biomechanical form cue, and give actionable tips to maintain proper form. "
            "5. Assign an objective strain rating (light, moderate, high, excessive), highlight standout achievements, and provide recovery recommendations."
        )

        workout_breakdown = ""
        for exercise in payload.exercises:
            sets_lines = []
            for s in exercise.completed_sets:
                rir_str = f", RIR: {s.rir}" if s.rir is not None else ""
                note_str = f", Note: \"{s.notes}\"" if s.notes else ""
                sets_lines.append(f"    - Set {s.set_number}: {s.weight} lbs x {s.reps} reps{rir_str}{note_str}")

            sets_formatted = "\n".join(sets_lines) if sets_lines else "    - No sets logged"
            workout_breakdown += (
                f"Exercise: {exercise.exercise_name} (Target Muscle: {exercise.target_muscle_group or 'Unspecified'})\n"
                f"Exercise Notes: {exercise.exercise_notes or 'None'}\n"
                f"Sets:\n{sets_formatted}\n\n"
            )

        prompt = (
            f"Workout Name: {payload.workout_name or 'Workout'}\n"
            f"Duration: {payload.duration_minutes or 'Not tracked'} minutes\n"
            f"Session Notes (Lifter Plan & Subjective State): {payload.session_notes or 'None'}\n\n"
            f"Exercise & Set Breakdown:\n{workout_breakdown or 'No exercises recorded.'}\n\n"
            "Generate a complete workout assessment: "
            "1. Total volume and per-muscle-group volume breakdown in muscle_group_volumes. "
            "2. Direct feedback on the lifter's session notes and plans in workout_notes_feedback. "
            "3. Progression recommendations and suggested weights for next time in progression_suggestions. "
            "4. Targeted form cues and technique maintenance tips in form_cues based on notes and heaviness. "
            "5. Strain rating, highlights, and recovery guidance."
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
    except Exception as e:
        print(f"[WORKOUT COACH FALLBACK] Activating deterministic coach: {e}", flush=True)
        return generate_deterministic_workout_feedback(payload)