import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

function WorkoutDetails({ workout, onBack }) {
    const [exercises, setExercises] = useState([])
    const [exerciseTypes, setExerciseTypes] = useState([]) 

    // Form State
    const [name, setName] = useState('')
    const [weight, setWeight] = useState('')
    const [reps, setReps] = useState('')
    const [sets, setSets] = useState('')

    // Editing State
    const [editingId, setEditingId] = useState(null)
    const [editValues, setEditValues] = useState({ name: '', weight: '', sets: '', reps: '' })

    const totalVolume = exercises.reduce((total, exercise) => total + (exercise.weight * exercise.reps * exercise.sets), 0)

    useEffect(() => {
        getExercises()
        getExerciseTypes() 
    }, [])

    async function getExercises() {
        const { data, error } = await supabase
            .from('exercises')
            .select('*')
            .eq('workout_id', workout.id)
            .order('created_at', { ascending: true })
        
        if (!error) setExercises(data)
    }

    async function getExerciseTypes() {
        const { data, error } = await supabase
            .from('exercise_types')
            .select('*')
            .order('name', { ascending: true })
        
        if (!error) setExerciseTypes(data)
    }

    async function addExercise() {
        if (!name || !weight || !reps || !sets) return alert("Please fill in all fields!")

        // Check if the name currently in the box exists in our list
        const exists = exerciseTypes.find(t => t.name.toLowerCase() === name.toLowerCase())
        
        // If it is brand new, save it to the 'exercise_types' table first
        if (!exists) {
            const { error: typeError } = await supabase
                .from('exercise_types')
                .insert([{ name: name }])
            
            if (!typeError) {
                // Refresh the list locally so it appears next time
                getExerciseTypes() 
            }
        }

        // Proceed as normal adding the specific set to the workout
        const { data, error } = await supabase
            .from('exercises')
            .insert([{ workout_id: workout.id, name, weight, reps, sets }])
            .select()

        if (error) {
            alert("Error saving exercise")
        } else {
            setExercises([...exercises, data[0]])
            setName(''); setWeight(''); setReps(''); setSets('')
        }
    }

    async function deleteExercise(id) {
        const { error } = await supabase.from('exercises').delete().eq('id', id)
        if (!error) setExercises(exercises.filter((e) => e.id !== id))
    }

    // Editing functions
    function startEditing(exercise) {
        setEditingId(exercise.id)
        setEditValues({ name: exercise.name, weight: exercise.weight, sets: exercise.sets, reps: exercise.reps })
    }

    async function saveEdit() {
        const { error } = await supabase.from('exercises').update(editValues).eq('id', editingId)
        if (!error) {
            setExercises(exercises.map(e => e.id === editingId ? { ...e, ...editValues } : e))
            setEditingId(null)
        }
    }

    return (
        <div className="details-container">
            <div className="back-button" style={{ marginBottom: '20px' }}>
                <button onClick={onBack} className='add-workout-button'>&larr; Back to List</button>
            </div>
            
            <h1 style={{textAlign: 'center'}}>{workout.name}</h1>
            <div style={{textAlign: 'center', marginTop: '20px', marginBottom: '20px', fontWeight: 'bold'}}>
                Total Volume: {totalVolume.toLocaleString()} lbs
            </div>
            
            {/* Add exercises form */}
            <div className="add-exercise-form" style={{ background: '#f0f0f0', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
                <h3 style={{color: 'black'}}>Add Exercise</h3>
                <br />
                <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
                    
                    <div style={{flex: '2'}}>
                        <input 
                            list="exercise-suggestions" 
                            placeholder="Name (e.g. Squat)" 
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="input-box"
                        />

                        <datalist id="exercise-suggestions">
                            {exerciseTypes.map(type => (
                                <option key={type.id} value={type.name} />
                            ))}
                        </datalist>
                    </div>

                    <input placeholder="Lbs" type="number" value={weight} onChange={(e) => setWeight(e.target.value)} className="input-box" style={{ width: '60px' }} />
                    <input placeholder="Sets" type="number" value={sets} onChange={(e) => setSets(e.target.value)} className="input-box" style={{ width: '60px' }} />
                    <input placeholder="Reps" type="number" value={reps} onChange={(e) => setReps(e.target.value)} className="input-box" style={{ width: '60px' }} />
                    <button onClick={addExercise} className="add-workout-button">Add</button>
                </div>
            </div>

            <div className="exercise-list">
                {exercises.map((exercise) => (
                    <div key={exercise.id} className="exercise-item" style={{ borderBottom: '1px solid #eee', padding: '10px 0' }}>
                        {editingId === exercise.id ? (
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', width: '100%' }}>
                                <input value={editValues.name} onChange={(e) => setEditValues({...editValues, name: e.target.value})} style={{padding: '5px', flex: 2}} />
                                <input type="number" value={editValues.weight} onChange={(e) => setEditValues({...editValues, weight: e.target.value})} style={{padding: '5px', width: '50px'}} />
                                <input type="number" value={editValues.sets} onChange={(e) => setEditValues({...editValues, sets: e.target.value})} style={{padding: '5px', width: '40px'}} />
                                <input type="number" value={editValues.reps} onChange={(e) => setEditValues({...editValues, reps: e.target.value})} style={{padding: '5px', width: '40px'}} />
                                <button onClick={saveEdit} className="edit-button" style={{backgroundColor: '#4CAF50', marginRight: '5px'}}>Save</button>
                                <button onClick={() => setEditingId(null)} className="delete-button" style={{backgroundColor: '#999'}}>Cancel</button>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                <div>
                                    <span style={{fontWeight: 'bold'}}>{exercise.name} </span>
                                    <span>{exercise.weight}lbs &bull; {exercise.sets} x {exercise.reps}</span>
                                </div>
                                <div>
                                    <button onClick={() => startEditing(exercise)} className='edit-button'>Edit</button>
                                    <button onClick={() => deleteExercise(exercise.id)} className='delete-button'>Delete</button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}

export default WorkoutDetails