import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// WorkoutDetails.jsx
function WorkoutDetails({ workout, onBack }) {
    // State for the list of exercises
    const [exercises, setExercises] = useState([])

    // State for the form inputs 
    const [name, setName] = useState('')
    const [weight, setWeight] = useState('')
    const [reps, setReps] = useState('')
    const [sets, setSets] = useState('')

    useEffect(() => {
        getExercises()
    }, [])

    async function getExercises() {
        const { data, error } = await supabase
            .from('exercises')
            .select('*')
            .eq('workout_id', workout.id) // Match exercises to this workout based on workout.id
        
        if (error) {
            console.error("Error fetching exercises: ", error)
        } else {
            setExercises(data)
        }
    }

    async function addExercise() {
        if (!name || !weight || !reps || !sets)  return alert("Please fill in all fields!")

        const { data, error } = await supabase
            .from('exercises')
            .insert([
                {
                    workout_id: workout.id, // Link to the current workout
                    name: name,
                    weight: weight,
                    reps: reps,
                    sets: sets
                }
            ])
            .select()

        if (error) {
            console.error(error)
            alert("Error saving exercise")
        } else {
            // Success: Update the list on the screen instantly
            setExercises([...exercises, data[0]])
            
            // Clear the form inputs
            setName('')
            setWeight('')
            setReps('')
            setSets('')
        }
    }

    async function deleteExercise(id) {
        const { error } = await supabase
            .from('exercises')
            .delete()
            .eq('id', id)

        if (error) {
            console.error("Error deleting:", error)
            alert("Could not delete exercise")
        } else {
            // Filter the list to remove the deleted item from the screen
            setExercises(exercises.filter((exercise) => exercise.id !== id))
        }
    }

    return (
        <div className="details-container">
            <div className="back-button" style={{ marginBottom: '20px' }}>
                <button onClick={onBack} className='add-workout-button'>&larr; Back to List</button>
            </div>
            
            <h1 style={{textAlign: 'center'}}>{workout.name}</h1>
            
            {/* input form */}
            <div className="add-exercise-form" style={{
                background: '#f0f0f0', 
                padding: '15px', 
                borderRadius: '8px', 
                marginBottom: '20px'
            }}>
                <h3 style={{color: 'black'}}>Add Exercise</h3>
                <br></br>
                <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
                    <input 
                        placeholder="Name (e.g. Squat)" 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        style={{padding: '8px', flex: '2'}}
                    />
                    <input 
                        placeholder="Lbs" 
                        type="number"
                        value={weight}
                        onChange={(e) => setWeight(e.target.value)}
                        style={{padding: '8px', width: '70px'}}
                    />
                     <input 
                        placeholder="Sets" 
                        type="number"
                        value={sets}
                        onChange={(e) => setSets(e.target.value)}
                        style={{padding: '8px', width: '70px'}}
                    />
                    <input 
                        placeholder="Reps" 
                        type="number"
                        value={reps}
                        onChange={(e) => setReps(e.target.value)}
                        style={{padding: '8px', width: '70px'}}
                    />
                    <button onClick={addExercise} style={{
                        padding: '8px 16px',
                        background: '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                    }}>Add</button>
                </div>
            </div>

            {/* Display exercises list */}
            <div className="exercise-list">
                {exercises.length === 0 ? (
                    <p style={{textAlign: 'center', fontStyle: 'italic', color: '#999'}}>
                        No exercises yet. Add one above!
                    </p>
                ) : (
                    exercises.map((exercise) => (
                        <div key={exercise.id} className="exercise-item" style={{
                            borderBottom: '1px solid #eee',
                            padding: '10px 0',
                            display: 'flex',
                            justifyContent: 'space-between'
                        }}>
                            <div>
                                <span style={{fontWeight: 'bold'}}>{exercise.name}</span>
                                <span>
                                    {exercise.weight}lbs &bull; {exercise.sets} x {exercise.reps}
                                </span>
                            </div>

                            <button 
                                onClick={() => deleteExercise(exercise.id)}
                                style={{
                                    background: '#ff4d4d', 
                                    color: 'white', 
                                    border: 'none', 
                                    padding: '8px 12px', 
                                    borderRadius: '6px', 
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >
                                Delete
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

export default WorkoutDetails