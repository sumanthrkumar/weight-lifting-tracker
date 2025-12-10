import WorkoutCard from './WorkoutCard'
import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

function WorkoutList() {

    // Start with an empty list of workouts
    const [workouts, setWorkouts] = useState([])

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

    return (
        <div className="workout-list">
            {/* Button to add a new workout */}
            <div style={{ marginBottom: '20px', textAlign: 'center' }}>
                <button onClick={addNewWorkout}
                style={{
                    padding: '12px 24px',
                    background: '#4c8df6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '50px',
                    fontSize: '1rem',
                    cursor: 'pointer'
                }}
                >
                Add new workout
                </button>
            </div>

            {workouts.length === 0 && (
                <p style={{ textAlign: 'center', marginTop: '2rem', color: '#888' }}>
                No workouts found. Time to hit the gym!
                </p>
            )}

            {workouts.map((workout) => (
                <WorkoutCard 
                key={workout.id} 
                title={workout.name}  
                date={new Date(workout.started_at).toLocaleDateString()} 
                />
            ))}
        </div>
    )
}

export default WorkoutList