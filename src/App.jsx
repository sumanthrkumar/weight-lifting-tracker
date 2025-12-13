import { useState } from 'react'
import './App.css'
import WorkoutList from './WorkoutList.jsx'
import WorkoutDetails from './WorkoutDetails.jsx'

function App() {
  
  const [selectedWorkout, setSelectedWorkout] = useState(null)

  return (
    <div className="app-container">
      <header className="navbar">
        <h1>Lifting Tracker</h1>
      </header>
    
      <main className='content'>
        {/* If selectedWorkout exists, show Details. If not then show WorkoutLists. */}
        {selectedWorkout ? (
            <WorkoutDetails 
                workout={selectedWorkout} 
                onBack={() => setSelectedWorkout(null)} 
            />
        ) : (
            <WorkoutList onWorkoutClick={setSelectedWorkout} />
        )}
      </main>
    </div>
  )
}

export default App
