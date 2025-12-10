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

    return (
        <div className="workout-list">
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