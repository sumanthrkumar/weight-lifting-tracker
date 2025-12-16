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
    const [editingId, setEditingId] = useState(null)
    const [editValues, setEditValues] = useState({ name: '', weight: '', sets: '', reps: '' })

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

    function startEditing(exercise) {
        setEditingId(exercise.id)
        setEditValues({
            name: exercise.name,
            weight: exercise.weight,
            sets: exercise.sets,
            reps: exercise.reps
        })
    }

    async function saveEdit() {
        const { error } = await supabase
            .from('exercises')
            .update(editValues)
            .eq('id', editingId)

        if (error) {
            alert("Error updating exercise")
        } else {
            // Update the list on screen without fetching from DB again
            setExercises(exercises.map(e => 
                e.id === editingId ? { ...e, ...editValues } : e
            ))
            setEditingId(null) // Exit edit mode
        }
    }

    function cancelEdit() {
        setEditingId(null) // Exit edit mode without
    }

    const totalVolume = exercises.reduce((total, exercise) => {
        const volume = exercise.weight * exercise.reps * exercise.sets
        return total + volume
    }, 0)

    return (
        <div className="details-container">
            <div className="back-button" style={{ marginBottom: '20px' }}>
                <button onClick={onBack} className='add-workout-button'>&larr; Back to List</button>
            </div>
            
            <h1 style={{textAlign: 'center'}}>{workout.name}</h1>

            <div style={{textAlign: 'center', marginTop: '20px', marginBottom: '20px', fontWeight: 'bold'}}>
                    Total Volume: {totalVolume.toLocaleString()} lbs
            </div>
            
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
                    <p style={{textAlign: 'center', color: '#999'}}>No exercises yet.</p>
                ) : (
                    exercises.map((exercise) => (
                        <div key={exercise.id} className="exercise-item" style={{ borderBottom: '1px solid #eee', padding: '10px 0' }}>
                            
                            {/* IF we are editing this exercise, show inputs */}
                            {editingId === exercise.id ? (
                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', width: '100%' }}>
                                    <input 
                                        value={editValues.name} 
                                        onChange={(e) => setEditValues({...editValues, name: e.target.value})}
                                        style={{padding: '5px', flex: 2}} 
                                    />
                                    <input 
                                        type="number" value={editValues.weight} 
                                        onChange={(e) => setEditValues({...editValues, weight: e.target.value})}
                                        style={{padding: '5px', width: '50px'}} 
                                    />
                                    <input 
                                        type="number" value={editValues.sets} 
                                        onChange={(e) => setEditValues({...editValues, sets: e.target.value})}
                                        style={{padding: '5px', width: '40px'}} 
                                    />
                                    <input 
                                        type="number" value={editValues.reps} 
                                        onChange={(e) => setEditValues({...editValues, reps: e.target.value})}
                                        style={{padding: '5px', width: '40px'}} 
                                    />
                                    <button onClick={saveEdit} style={{background: '#4CAF50', color: 'white', border: 'none', padding: '5px 10px', cursor: 'pointer', borderRadius: '4px'}}>Save</button>
                                    <button onClick={cancelEdit} style={{background: '#9e9e9e', color: 'white', border: 'none', padding: '5px 10px', cursor: 'pointer', borderRadius: '4px'}}>Cancel</button>
                                </div>
                            ) : (
                                /* ELSE show normal text */
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                    <div>
                                        <span style={{fontWeight: 'bold'}}>{exercise.name} </span>
                                        <span>{exercise.weight}lbs &bull; {exercise.sets} x {exercise.reps}</span>
                                    </div>
                                    <div>
                                        <button 
                                            onClick={() => startEditing(exercise)} className='edit-button'
                                        >
                                            Edit
                                        </button>
                                        <button 
                                            onClick={() => deleteExercise(exercise.id)}
                                            className='delete-button'
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

export default WorkoutDetails