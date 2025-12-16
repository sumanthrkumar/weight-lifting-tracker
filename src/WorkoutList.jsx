import WorkoutCard from './WorkoutCard'
import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

function WorkoutList({ onWorkoutClick }) {

    // Start with an empty list of workouts
    const [workouts, setWorkouts] = useState([])

    // State for Editing
    const [editingId, setEditingId] = useState(null)
    const [editName, setEditName] = useState('')

    //Run this code ONLY when the page first loads
    useEffect(() => {
        getWorkouts()
    }, [])

    //Get data from database
    async function getWorkouts() {
        // Select all from 'workouts'
        const { data, error } = await supabase
        .from('workouts')
        .select('*')
        if (error) {
            console.error("Error fetching workouts:", error)
        } else {
            // If we got data, put it into our State
            setWorkouts(data)
        }
    }

    async function addNewWorkout() {
        const name = prompt("Enter workout name (ex: 'Leg Day'):")
        if (!name) return 

        // Insert into database
        const { data, error } = await supabase
            .from('workouts')
            .insert([
            { name: name, started_at: new Date() }
            ])
            .select() 

        if (error) {
            console.error("Error adding workout:", error)
            alert("Error saving to database!")
        } else {
            // Update UI immediately
            setWorkouts([data[0], ...workouts])
        }
    }

    async function deleteWorkout(id, e) {
        e.stopPropagation() 

        if (!confirm("Are you sure? This will delete all exercises for this workout.")) return

        // 1. Delete all exercises belonging to this workout first (Safety Step)
        await supabase.from('exercises').delete().eq('workout_id', id)

        // 2. Now delete the workout itself
        const { error } = await supabase.from('workouts').delete().eq('id', id)

        if (error) {
            alert("Error deleting workout")
        } else {
            setWorkouts(workouts.filter(w => w.id !== id))
        }
    }

    function startEditing(workout, e) {
        e.stopPropagation() // Don't open the details card
        setEditingId(workout.id)
        setEditName(workout.name)
    }

    async function saveEdit(id, e) {
        e.stopPropagation() // Don't open the details card
        
        const { error } = await supabase
            .from('workouts')
            .update({ name: editName })
            .eq('id', id)

        if (error) {
            alert("Error updating name")
        } else {
            // Update local list
            setWorkouts(workouts.map(w => w.id === id ? { ...w, name: editName } : w))
            setEditingId(null)
        }
    }

    function cancelEdit(e) {
        e.stopPropagation()
        setEditingId(null)
    }

    return (
        <div className="workout-list">
            <div style={{ marginBottom: '20px', textAlign: 'center' }}>
                <button onClick={addNewWorkout} className='add-workout-button'>
                Add new workout
                </button>
            </div>

            {workouts.length === 0 && (
                <p style={{ textAlign: 'center', marginTop: '2rem', color: '#888' }}>
                No workouts found. Time to hit the gym!
                </p>
            )}

            {workouts.map((workout) => (
                <div key={workout.id} style={{position: 'relative'}}>
                    {/* If we are editing this one, show a FORM. 
                        Otherwise, show the CARD 
                    */}
                    
                    {editingId === workout.id ? (
                        // --- EDIT MODE ---
                        <div className="card" style={{display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'center'}}>
                            <input 
                                value={editName} 
                                onChange={(e) => setEditName(e.target.value)}
                                style={{padding: '8px', fontSize: '1.2rem', width: '100%'}}
                                autoFocus
                            />
                            <button onClick={(e) => saveEdit(workout.id, e)} className="edit-button">Save</button>
                            <button onClick={cancelEdit} className="delete-button" style={{backgroundColor: '#999'}}>Cancel</button>
                        </div>
                    ) : (
                        // --- VIEW MODE ---
                        // We wrap the Card in a div so we can put buttons on top of it
                        <div 
                            className="card-container" 
                            style={{position: 'relative'}}
                        >
                            <WorkoutCard 
                                title={workout.name}  
                                date={new Date(workout.started_at).toLocaleDateString()}
                                onCardClick={() => onWorkoutClick(workout)}
                            />
                            
                            {/* Floating Action Buttons */}
                            <div style={{
                                position: 'absolute', 
                                right: '15px', 
                                top: '50%', 
                                transform: 'translateY(-50%)',
                                display: 'flex',
                                gap: '5px'
                            }}>
                                <button 
                                    onClick={(e) => startEditing(workout, e)}
                                    className='edit-button'
                                    style={{padding: '5px 10px', fontSize: '0.8rem'}}
                                >
                                    Edit
                                </button>
                                <button 
                                    onClick={(e) => deleteWorkout(workout.id, e)}
                                    className='delete-button'
                                    style={{padding: '5px 10px', fontSize: '0.8rem'}}
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    )
}

export default WorkoutList